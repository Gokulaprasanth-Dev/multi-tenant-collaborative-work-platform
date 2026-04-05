/**
 * Integration tests for jwt.service.ts
 * Requires DATABASE_URL and REDIS_URL env vars.
 * Run: npm run migrate:test && npm run test:integration
 */

import jwt from 'jsonwebtoken';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import { redisClient } from '../../../src/shared/redis/clients';
import {
  issueTokenPair,
  refreshTokenPair,
  revokeTokens,
} from '../../../src/modules/auth/services/jwt.service';
import { UnauthorizedError } from '../../../src/shared/errors/app-errors';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('jwt.service integration', () => {
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    const user = await seedUser();
    userId = user.userId;
    const org = await seedOrg({ ownerId: userId });
    orgId = org.orgId;
  });

  afterEach(async () => {
    await queryPrimary(
      `DELETE FROM refresh_tokens WHERE user_id = $1`,
      [userId]
    );
  });

  // ── issueTokenPair ────────────────────────────────────────────────────────

  describe('issueTokenPair', () => {
    it('returns accessToken, refreshToken, and expiresIn', async () => {
      const result = await issueTokenPair(userId, orgId, 'org_owner', false);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('expiresIn');
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
      expect(typeof result.expiresIn).toBe('number');
      expect(result.expiresIn).toBeGreaterThan(0);
    });

    it('stores a refresh token row in DB with correct user_id and is_revoked=false', async () => {
      await issueTokenPair(userId, orgId, 'org_owner', false);

      const result = await queryPrimary<{ user_id: string; is_revoked: boolean }>(
        `SELECT user_id, is_revoked FROM refresh_tokens WHERE user_id = $1 LIMIT 1`,
        [userId]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.user_id).toBe(userId);
      expect(result.rows[0]!.is_revoked).toBe(false);
    });
  });

  // ── refreshTokenPair ──────────────────────────────────────────────────────

  describe('refreshTokenPair', () => {
    it('with valid token returns new accessToken and refreshToken', async () => {
      const { refreshToken } = await issueTokenPair(userId, orgId, 'org_owner', false);
      const result = await refreshTokenPair(refreshToken);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('expiresIn');
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
    });

    it('rotates the token — old token is_revoked=true in DB after refresh', async () => {
      const { refreshToken } = await issueTokenPair(userId, orgId, 'org_owner', false);

      // Capture old token hash to look it up later
      const { hashToken } = await import('../../../src/shared/crypto');
      const oldHash = hashToken(refreshToken);

      await refreshTokenPair(refreshToken);

      const result = await queryPrimary<{ is_revoked: boolean }>(
        `SELECT is_revoked FROM refresh_tokens WHERE token_hash = $1`,
        [oldHash]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.is_revoked).toBe(true);
    });

    it('with revoked token throws UnauthorizedError with code TOKEN_FAMILY_REVOKED', async () => {
      const { refreshToken } = await issueTokenPair(userId, orgId, 'org_owner', false);

      // Manually revoke the refresh token row
      await queryPrimary(
        `UPDATE refresh_tokens SET is_revoked = true, revoked_at = NOW() WHERE user_id = $1`,
        [userId]
      );

      await expect(refreshTokenPair(refreshToken)).rejects.toMatchObject({
        code: 'TOKEN_FAMILY_REVOKED',
      });

      const err = await refreshTokenPair(refreshToken).catch((e) => e);
      expect(err).toBeInstanceOf(UnauthorizedError);
    });

    it('with expired token throws UnauthorizedError with code TOKEN_EXPIRED', async () => {
      const { refreshToken } = await issueTokenPair(userId, orgId, 'org_owner', false);

      // Set expires_at to the past
      await queryPrimary(
        `UPDATE refresh_tokens SET expires_at = NOW() - INTERVAL '1 day' WHERE user_id = $1`,
        [userId]
      );

      const err = await refreshTokenPair(refreshToken).catch((e) => e);
      expect(err).toBeInstanceOf(UnauthorizedError);
      expect(err.code).toBe('TOKEN_EXPIRED');
    });

    it('with unknown token throws UnauthorizedError with code TOKEN_NOT_FOUND', async () => {
      const fakeToken = 'a'.repeat(64); // 64-char hex string — valid length, unknown hash

      const err = await refreshTokenPair(fakeToken).catch((e) => e);
      expect(err).toBeInstanceOf(UnauthorizedError);
      expect(err.code).toBe('TOKEN_NOT_FOUND');
    });
  });

  // ── revokeTokens ─────────────────────────────────────────────────────────

  describe('revokeTokens', () => {
    it('blacklists access token in Redis and marks refresh token revoked', async () => {
      const { accessToken, refreshToken, expiresIn } = await issueTokenPair(
        userId,
        orgId,
        'org_owner',
        false
      );

      const decoded = jwt.decode(accessToken) as { jti: string };
      const jti = decoded.jti;

      await revokeTokens(refreshToken, jti, expiresIn);

      // Verify Redis blacklist key exists — key format: blacklist:token:{jti}
      const redisKey = `blacklist:token:${jti}`;
      const val = await redisClient.get(redisKey);
      expect(val).toBeTruthy();

      // Verify refresh token is revoked in DB
      const { hashToken } = await import('../../../src/shared/crypto');
      const tokenHash = hashToken(refreshToken);
      const result = await queryPrimary<{ is_revoked: boolean }>(
        `SELECT is_revoked FROM refresh_tokens WHERE token_hash = $1`,
        [tokenHash]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.is_revoked).toBe(true);

      // Cleanup Redis key
      await redisClient.del(redisKey);
    });
  });
});
