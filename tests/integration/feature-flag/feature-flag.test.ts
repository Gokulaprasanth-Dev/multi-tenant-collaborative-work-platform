/**
 * Integration tests for Feature Flag API (Phase 3)
 *
 * Covers:
 * - Create flag (platform admin only)
 * - List flags
 * - Update flag (enable globally, add org to enabled_org_ids)
 * - Delete flag
 * - Non-admin cannot manage flags (403)
 * - isEnabled() resolves correctly per org
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../../src/app';
import { seedUser, seedOrg, getTestJwt } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import { redisClient } from '../../../src/shared/redis/clients';
import { isEnabled } from '../../../src/modules/feature-flag/feature-flag.service';
import { generateAccessToken } from '../../../src/modules/auth/utils/token';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

let platformAdminUserId: string;
let platformAdminOrgId: string;

async function getPlatformAdminToken(): Promise<string> {
  const admin = await seedUser({ isPlatformAdmin: true });
  const org = await seedOrg({ ownerId: admin.userId });
  platformAdminUserId = admin.userId;
  platformAdminOrgId = org.orgId;
  // Must include mfaVerifiedAt — platformAdminMiddleware requires it
  return generateAccessToken({
    sub: admin.userId,
    orgId: org.orgId,
    role: 'org_owner',
    isPlatformAdmin: true,
    mfaVerifiedAt: Math.floor(Date.now() / 1000),
  });
}

maybeDescribe('Feature Flag API', () => {
  let adminToken: string;
  let memberToken: string;
  let orgId: string;

  beforeAll(async () => {
    adminToken = await getPlatformAdminToken();
    const member = await seedUser();
    const org = await seedOrg({ ownerId: member.userId });
    orgId = org.orgId;
    memberToken = await getTestJwt(member.email, member.password, org.orgId);
  });

  afterEach(async () => {
    // Bust Redis cache so isEnabled() re-reads from DB
    await redisClient.del('featureflags:cache');
  });

  // ── Create ────────────────────────────────────────────────────────────────

  describe('POST /admin/feature-flags', () => {
    it('platform admin can create a flag (201)', async () => {
      const key = `test.flag.${uuidv4().slice(0, 8)}`;
      const res = await request(app)
        .post('/api/v1/admin/feature-flags')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .send({ key, is_globally_enabled: false, description: 'Test flag' })
        .expect(201);

      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.key).toBe(key);
      expect(res.body.data.is_globally_enabled).toBe(false);

      // Cleanup
      await queryPrimary(`DELETE FROM feature_flags WHERE key = $1`, [key]);
    });

    it('non-admin cannot create flag (403)', async () => {
      await request(app)
        .post('/api/v1/admin/feature-flags')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ key: 'test.flag.forbidden', is_globally_enabled: false })
        .expect(403);
    });

    it('rejects missing key (400)', async () => {
      await request(app)
        .post('/api/v1/admin/feature-flags')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .send({ is_globally_enabled: true })
        .expect(400);
    });

    it('returns 401 without auth', async () => {
      await request(app)
        .post('/api/v1/admin/feature-flags')
        .send({ key: 'test.flag.unauth' })
        .expect(401);
    });
  });

  // ── List ──────────────────────────────────────────────────────────────────

  describe('GET /admin/feature-flags', () => {
    it('platform admin can list flags', async () => {
      const res = await request(app)
        .get('/api/v1/admin/feature-flags')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('non-admin gets 403', async () => {
      await request(app)
        .get('/api/v1/admin/feature-flags')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
    });
  });

  // ── Update ────────────────────────────────────────────────────────────────

  describe('PATCH /admin/feature-flags/:id', () => {
    it('can enable a flag globally', async () => {
      const key = `test.flag.update.${uuidv4().slice(0, 8)}`;

      // Create flag
      const createRes = await request(app)
        .post('/api/v1/admin/feature-flags')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .send({ key, is_globally_enabled: false })
        .expect(201);

      const flagId = (createRes.body.data as { id: string }).id;

      // Enable globally
      const updateRes = await request(app)
        .patch(`/api/v1/admin/feature-flags/${flagId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .send({ is_globally_enabled: true })
        .expect(200);

      expect(updateRes.body.data.is_globally_enabled).toBe(true);

      // Cleanup
      await queryPrimary(`DELETE FROM feature_flags WHERE id = $1`, [flagId]);
    });

    it('can add org to enabled_org_ids', async () => {
      const key = `test.flag.orgids.${uuidv4().slice(0, 8)}`;

      const createRes = await request(app)
        .post('/api/v1/admin/feature-flags')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .send({ key, is_globally_enabled: false })
        .expect(201);

      const flagId = (createRes.body.data as { id: string }).id;

      await request(app)
        .patch(`/api/v1/admin/feature-flags/${flagId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .send({ enabled_org_ids: [orgId] })
        .expect(200);

      // Verify isEnabled() returns true for this org
      const enabled = await isEnabled(orgId, key);
      expect(enabled).toBe(true);

      // Cleanup
      await queryPrimary(`DELETE FROM feature_flags WHERE id = $1`, [flagId]);
    });
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  describe('DELETE /admin/feature-flags/:id', () => {
    it('platform admin can delete a flag', async () => {
      const key = `test.flag.delete.${uuidv4().slice(0, 8)}`;

      const createRes = await request(app)
        .post('/api/v1/admin/feature-flags')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .send({ key, is_globally_enabled: false })
        .expect(201);

      const flagId = (createRes.body.data as { id: string }).id;

      await request(app)
        .delete(`/api/v1/admin/feature-flags/${flagId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .expect(200);

      // Flag no longer in list
      const listRes = await request(app)
        .get('/api/v1/admin/feature-flags')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', '127.0.0.1')
        .expect(200);

      const ids = (listRes.body.data as { id: string }[]).map(f => f.id);
      expect(ids).not.toContain(flagId);
    });
  });

  // ── isEnabled() logic ─────────────────────────────────────────────────────

  describe('isEnabled() resolution', () => {
    it('globally enabled flag returns true for any org', async () => {
      const key = `test.global.${uuidv4().slice(0, 8)}`;
      await queryPrimary(
        `INSERT INTO feature_flags (key, is_globally_enabled, enabled_org_ids, disabled_org_ids)
         VALUES ($1, true, '{}', '{}')`,
        [key]
      );
      await redisClient.del('featureflags:cache');

      const result = await isEnabled(uuidv4(), key);
      expect(result).toBe(true);

      await queryPrimary(`DELETE FROM feature_flags WHERE key = $1`, [key]);
    });

    it('disabled_org_ids overrides global enable', async () => {
      const targetOrgId = uuidv4();
      const key = `test.disabled.${uuidv4().slice(0, 8)}`;
      await queryPrimary(
        `INSERT INTO feature_flags (key, is_globally_enabled, enabled_org_ids, disabled_org_ids)
         VALUES ($1, true, '{}', ARRAY[$2::uuid])`,
        [key, targetOrgId]
      );
      await redisClient.del('featureflags:cache');

      const result = await isEnabled(targetOrgId, key);
      expect(result).toBe(false);

      await queryPrimary(`DELETE FROM feature_flags WHERE key = $1`, [key]);
    });

    it('unknown flag returns false (fail-closed)', async () => {
      await redisClient.del('featureflags:cache');
      const result = await isEnabled(uuidv4(), `nonexistent.flag.${uuidv4()}`);
      expect(result).toBe(false);
    });
  });
});
