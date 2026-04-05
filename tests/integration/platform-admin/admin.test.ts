/**
 * Integration tests for Platform Admin API routes (TASK-088)
 * Requires live PostgreSQL and Redis.
 */

import request from 'supertest';
import { app } from '../../../src/app';
import { primaryPool } from '../../../src/shared/database/pool';
import { queryPrimary } from '../../../src/shared/database/pool';
import { seedUser, seedOrg } from '../../helpers/db';
import { generateAccessToken } from '../../../src/modules/auth/utils/token';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

/** Build a platform admin JWT with the given overrides */
async function makePlatformAdminToken(opts: {
  mfaVerifiedAt?: number | null;
  ip?: string;
} = {}): Promise<{ token: string; userId: string; orgId: string }> {
  const admin = await seedUser({ isPlatformAdmin: true });
  const org = await seedOrg({ ownerId: admin.userId });
  const mfaVerifiedAt = opts.mfaVerifiedAt === undefined
    ? Math.floor(Date.now() / 1000)   // default: now (valid)
    : opts.mfaVerifiedAt ?? undefined; // null → omit field

  const token = generateAccessToken({
    sub: admin.userId,
    orgId: org.orgId,
    role: 'org_owner',
    isPlatformAdmin: true,
    ...(mfaVerifiedAt !== null ? { mfaVerifiedAt } : {}),
  });
  return { token, userId: admin.userId, orgId: org.orgId };
}

maybeDescribe('Platform Admin API', () => {
  // All admin routes require platformAdminMiddleware

  // ── platformAdminMiddleware tests ──────────────────────────────────────────

  describe('platformAdminMiddleware', () => {
    it('returns 401 without token', async () => {
      await request(app)
        .get('/api/v1/admin/organizations')
        .expect(401);
    });

    it('returns 403 PLATFORM_ADMIN_REQUIRED for non-admin JWT', async () => {
      // Register a regular user
      const email = `regular-user+${Date.now()}@example.com`;
      await request(app)
        .post('/api/v1/auth/register')
        .send({ email, password: 'Password123!', name: 'Regular User' })
        .expect(201);

      // Verify email directly in DB
      await primaryPool.query(
        `UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE email = $1`,
        [email]
      );

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'Password123!' })
        .expect(200);
      const token = (loginRes.body.data as { tokens: { accessToken: string } }).tokens.accessToken;

      const res = await request(app)
        .get('/api/v1/admin/organizations')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(res.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
    });

    it('returns 403 MFA_REQUIRED for admin JWT without mfaVerifiedAt', async () => {
      const admin = await seedUser({ isPlatformAdmin: true });
      const org = await seedOrg({ ownerId: admin.userId });
      // Explicitly omit mfaVerifiedAt
      const token = generateAccessToken({
        sub: admin.userId,
        orgId: org.orgId,
        role: 'org_owner',
        isPlatformAdmin: true,
      });

      const res = await request(app)
        .get('/api/v1/admin/organizations')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .expect(403);

      expect(res.body.error.code).toBe('MFA_REQUIRED');
    });

    it('returns 403 MFA_SESSION_EXPIRED for admin JWT with old mfaVerifiedAt', async () => {
      // mfaVerifiedAt 61 minutes ago
      const oldMfaVerifiedAt = Math.floor(Date.now() / 1000) - 61 * 60;
      const { token } = await makePlatformAdminToken({ mfaVerifiedAt: oldMfaVerifiedAt });

      const res = await request(app)
        .get('/api/v1/admin/organizations')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .expect(403);

      expect(res.body.error.code).toBe('MFA_SESSION_EXPIRED');
    });

    it('allows access with valid platform admin JWT and recent mfaVerifiedAt', async () => {
      const { token } = await makePlatformAdminToken();

      const res = await request(app)
        .get('/api/v1/admin/organizations')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ── MFA Reset (RUNBOOK §5.5) ───────────────────────────────────────────────

  it('resetUserMfa clears TOTP fields', async () => {
    const { token, userId: adminId } = await makePlatformAdminToken();

    // Seed a regular user with MFA enabled
    const target = await seedUser();
    await queryPrimary(
      `UPDATE users
       SET totp_enabled = true,
           totp_secret  = 'BASE32SECRET',
           mfa_backup_codes = ARRAY['code1','code2']
       WHERE id = $1`,
      [target.userId]
    );

    const res = await request(app)
      .post(`/api/v1/admin/users/${target.userId}/reset-mfa`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', '127.0.0.1')
      .expect(200);

    expect(res.body.data.mfaReset).toBe(true);

    // Verify DB was updated
    const row = await queryPrimary<{
      totp_enabled: boolean;
      totp_secret: string | null;
      mfa_backup_codes: string[];
    }>(
      `SELECT totp_enabled, totp_secret, mfa_backup_codes FROM users WHERE id = $1`,
      [target.userId]
    );
    const user = row.rows[0]!;
    expect(user.totp_enabled).toBe(false);
    expect(user.totp_secret).toBeNull();
    expect(user.mfa_backup_codes).toEqual([]);
  });

  // ── Suspend / Reactivate org ───────────────────────────────────────────────

  describe('org lifecycle (suspend / reactivate)', () => {
    it('platform admin can suspend and reactivate an org', async () => {
      const { token } = await makePlatformAdminToken();
      const owner = await seedUser();
      const { orgId } = await seedOrg({ ownerId: owner.userId });

      // Suspend
      const suspendRes = await request(app)
        .post(`/api/v1/admin/organizations/${orgId}/suspend`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .send({ reason: 'integration-test' })
        .expect(200);

      expect(suspendRes.body.data.suspended).toBe(true);

      // Reactivate
      const reactivateRes = await request(app)
        .post(`/api/v1/admin/organizations/${orgId}/reactivate`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .expect(200);

      expect(reactivateRes.body.data.reactivated).toBe(true);
    });
  });

  // ── User unlock ────────────────────────────────────────────────────────────

  describe('POST /admin/users/:userId/unlock', () => {
    it('unlocks a locked user account', async () => {
      const { token } = await makePlatformAdminToken();
      const target = await seedUser();

      // Lock the account via locked_until (not a status value)
      await queryPrimary(
        `UPDATE users SET locked_until = NOW() + INTERVAL '15 minutes', failed_login_attempts = 5 WHERE id = $1`,
        [target.userId]
      );

      const res = await request(app)
        .post(`/api/v1/admin/users/${target.userId}/unlock`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .expect(200);

      expect(res.body.data.unlocked).toBe(true);

      const row = await queryPrimary<{ locked_until: Date | null; failed_login_attempts: number }>(
        `SELECT locked_until, failed_login_attempts FROM users WHERE id = $1`,
        [target.userId]
      );
      expect(row.rows[0]!.locked_until).toBeNull();
      expect(row.rows[0]!.failed_login_attempts).toBe(0);
    });
  });
});
