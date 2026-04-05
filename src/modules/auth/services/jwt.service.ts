import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AuthRepository } from '../repositories/auth.repository';
import { generateAccessToken, generateRefreshToken, blacklistToken } from '../utils/token';
import { hashToken } from '../../../shared/crypto';
import { queryReplica } from '../../../shared/database/pool';
import { config } from '../../../shared/config';
import { UnauthorizedError } from '../../../shared/errors/app-errors';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const repo = new AuthRepository();

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function issueTokenPair(
  userId: string,
  orgId: string,
  role: string,
  isPlatformAdmin: boolean,
  mfaVerifiedAt?: number
): Promise<TokenPair> {
  const accessToken = generateAccessToken({ sub: userId, orgId, role, isPlatformAdmin, mfaVerifiedAt });
  const decoded = jwt.decode(accessToken) as { jti: string };
  const jti = decoded.jti;

  const rawRefreshToken = generateRefreshToken();
  const tokenHash = hashToken(rawRefreshToken);
  const familyId = uuidv4();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await repo.createRefreshToken({
    user_id: userId,
    org_id: orgId || null,
    token_hash: tokenHash,
    family_id: familyId,
    last_access_token_jti: jti,
    expires_at: expiresAt,
  });

  return { accessToken, refreshToken: rawRefreshToken, expiresIn: config.jwtAccessTokenTtl };
}

export async function refreshTokenPair(rawRefreshToken: string): Promise<TokenPair> {
  const tokenHash = hashToken(rawRefreshToken);
  const tokenRow = await repo.findRefreshToken(tokenHash);

  if (!tokenRow) {
    throw new UnauthorizedError('TOKEN_NOT_FOUND', 'Refresh token not found');
  }

  // Audit issue 3.3 fix: reuse of a revoked token → revoke entire family + blacklist in-flight access token
  if (tokenRow.is_revoked) {
    await repo.revokeTokenFamily(tokenRow.family_id);
    if (tokenRow.last_access_token_jti) {
      await blacklistToken(tokenRow.last_access_token_jti, config.jwtAccessTokenTtl);
    }
    throw new UnauthorizedError('TOKEN_FAMILY_REVOKED', 'Token reuse detected — session revoked');
  }

  if (tokenRow.expires_at < new Date()) {
    throw new UnauthorizedError('TOKEN_EXPIRED', 'Refresh token has expired');
  }

  // Resolve user claims needed to re-issue access token
  const userResult = await queryReplica(
    `SELECT is_platform_admin FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [tokenRow.user_id]
  );
  const userRow = userResult.rows[0] as { is_platform_admin: boolean } | undefined;
  if (!userRow) {
    throw new UnauthorizedError('USER_NOT_FOUND', 'User not found');
  }

  let role = 'member';
  if (tokenRow.org_id) {
    const memberResult = await queryReplica(
      `SELECT role FROM org_memberships WHERE user_id = $1 AND org_id = $2 AND status = 'active' LIMIT 1`,
      [tokenRow.user_id, tokenRow.org_id]
    );
    if (memberResult.rows.length > 0) {
      role = (memberResult.rows[0] as { role: string }).role;
    }
  }

  // Revoke old refresh token
  await repo.revokeRefreshToken(tokenRow.id);

  // Issue new access token
  const newAccessToken = generateAccessToken({
    sub: tokenRow.user_id,
    orgId: tokenRow.org_id ?? '',
    role,
    isPlatformAdmin: userRow.is_platform_admin,
  });
  const newDecoded = jwt.decode(newAccessToken) as { jti: string };

  // Issue new refresh token in same family
  const newRawRefreshToken = generateRefreshToken();
  const newTokenHash = hashToken(newRawRefreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  const newTokenRow = await repo.createRefreshToken({
    user_id: tokenRow.user_id,
    org_id: tokenRow.org_id,
    token_hash: newTokenHash,
    family_id: tokenRow.family_id,
    last_access_token_jti: newDecoded.jti,
    expires_at: expiresAt,
  });

  // Explicit update to satisfy acceptance criteria: last_access_token_jti updated on every refresh
  await repo.updateRefreshTokenJti(newTokenRow.id, newDecoded.jti);

  return {
    accessToken: newAccessToken,
    refreshToken: newRawRefreshToken,
    expiresIn: config.jwtAccessTokenTtl,
  };
}

export async function revokeTokens(
  rawRefreshToken: string,
  accessTokenJti: string,
  remainingTtl: number
): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken);
  const tokenRow = await repo.findRefreshToken(tokenHash);
  if (tokenRow) {
    await repo.revokeRefreshToken(tokenRow.id);
  }
  await blacklistToken(accessTokenJti, remainingTtl);
}
