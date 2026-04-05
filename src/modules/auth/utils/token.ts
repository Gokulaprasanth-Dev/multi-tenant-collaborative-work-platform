import * as crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../../shared/config';
import { redisClient } from '../../../shared/redis/clients';
import { hashToken, timingSafeEqual } from '../../../shared/crypto';

const KID = 'default';

export interface AccessTokenPayload {
  sub: string;
  orgId: string;
  role: string;
  isPlatformAdmin?: boolean;
  mfaVerifiedAt?: number;
}

export function generateAccessToken(payload: AccessTokenPayload): string {
  const jti = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      sub: payload.sub,
      orgId: payload.orgId,
      role: payload.role,
      isPlatformAdmin: payload.isPlatformAdmin ?? false,
      mfaVerifiedAt: payload.mfaVerifiedAt,
      auth_time: now,
      jti,
    },
    config.jwtPrivateKey,
    {
      algorithm: 'RS256',
      expiresIn: config.jwtAccessTokenTtl,
      keyid: KID,
    }
  );
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateEmailVerificationToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  return { token, hash, expiresAt };
}

export function generatePasswordResetToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h
  return { token, hash, expiresAt };
}

export function generateMagicLinkToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(token);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15min
  return { token, hash, expiresAt };
}

export async function blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
  await redisClient.set('blacklist:token:' + jti, '1', 'EX', ttlSeconds);
}

export function verifyTokenHash(supplied: string, stored: string): boolean {
  return timingSafeEqual(stored, hashToken(supplied));
}

export { hashToken };
