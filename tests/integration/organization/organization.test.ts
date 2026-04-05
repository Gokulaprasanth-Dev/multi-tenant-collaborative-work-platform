/**
 * Integration tests for Organization API routes (TASK-046)
 * Requires live PostgreSQL and Redis instances.
 * Run with: npx jest tests/integration/organization
 */

import request from 'supertest';
import { app } from '../../../src/app';
import { primaryPool } from '../../../src/shared/database/pool';
import { v4 as uuidv4 } from 'uuid';

// These tests are marked with a custom environment check so they only run
// when DATABASE_URL and REDIS_URL are present (CI or local dev with Docker).
const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Organization API', () => {
  let accessToken: string;
  let orgId: string;

  // Helpers
  async function registerAndLogin(): Promise<{ token: string; orgId: string }> {
    const email = `test+${Date.now()}@example.com`;
    const slug = `test-org-setup-${Date.now()}`;

    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password123!', name: 'Test User' })
      .expect(201);

    // Verify email directly in DB
    await primaryPool.query(
      `UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE email = $1`,
      [email]
    );

    // Login without orgId to get a token for org creation
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    const preOrgToken = (loginRes.body.data as { tokens: { accessToken: string } }).tokens.accessToken;

    // Create org
    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${preOrgToken}`)
      .set('Idempotency-Key', uuidv4())
      .send({ name: 'Test Org', slug })
      .expect(201);
    const _orgId = (orgRes.body.data as { id: string }).id;

    // Login with orgId to get org-scoped token
    const orgLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!', orgId: _orgId })
      .expect(200);
    const token = (orgLoginRes.body.data as { tokens: { accessToken: string } }).tokens.accessToken;

    return { token, orgId: _orgId };
  }

  beforeAll(async () => {
    const ctx = await registerAndLogin();
    accessToken = ctx.token;
    orgId = ctx.orgId;
  });

  // ── POST /api/v1/orgs ──────────────────────────────────────────────────────
  describe('POST /api/v1/orgs', () => {
    it('creates an org and returns 201', async () => {
      const slug = `test-org-${Date.now()}`;

      // Need a fresh pre-org token (no org scope required for org creation)
      const email = `test-neworg+${Date.now()}@example.com`;
      await request(app)
        .post('/api/v1/auth/register')
        .send({ email, password: 'Password123!', name: 'New Org User' })
        .expect(201);
      await primaryPool.query(
        `UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE email = $1`,
        [email]
      );
      const freshLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'Password123!' })
        .expect(200);
      const freshToken = (freshLogin.body.data as { tokens: { accessToken: string } }).tokens.accessToken;

      const res = await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${freshToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'Test Org', slug })
        .expect(201);

      expect(res.body.data).toMatchObject({ name: 'Test Org', slug, status: 'active' });
    });

    it('returns 409 for duplicate slug', async () => {
      const slug = `dupe-${Date.now()}`;

      // Need a fresh pre-org token
      const email = `test-dupe+${Date.now()}@example.com`;
      await request(app)
        .post('/api/v1/auth/register')
        .send({ email, password: 'Password123!', name: 'Dupe Org User' })
        .expect(201);
      await primaryPool.query(
        `UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE email = $1`,
        [email]
      );
      const freshLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'Password123!' })
        .expect(200);
      const freshToken = (freshLogin.body.data as { tokens: { accessToken: string } }).tokens.accessToken;

      await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${freshToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'Org A', slug })
        .expect(201);

      await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${freshToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'Org B', slug })
        .expect(409);
    });

    it('returns 400 for invalid slug (uppercase)', async () => {
      // Need a fresh pre-org token
      const email = `test-badslug+${Date.now()}@example.com`;
      await request(app)
        .post('/api/v1/auth/register')
        .send({ email, password: 'Password123!', name: 'Bad Slug User' })
        .expect(201);
      await primaryPool.query(
        `UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE email = $1`,
        [email]
      );
      const freshLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'Password123!' })
        .expect(200);
      const freshToken = (freshLogin.body.data as { tokens: { accessToken: string } }).tokens.accessToken;

      await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${freshToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'Bad Org', slug: 'UPPERCASE' })
        .expect(400);
    });

    it('returns 401 without JWT', async () => {
      await request(app)
        .post('/api/v1/orgs')
        .send({ name: 'No Auth', slug: `no-auth-${Date.now()}` })
        .expect(401);
    });
  });

  // ── GET /api/v1/orgs/:orgId ────────────────────────────────────────────────
  describe('GET /api/v1/orgs/:orgId', () => {
    it('returns the org for a member', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(res.body.data).toMatchObject({ id: orgId });
    });

    it('returns 401 without JWT', async () => {
      await request(app).get(`/api/v1/orgs/${orgId}`).expect(401);
    });
  });

  // ── PATCH /api/v1/orgs/:orgId ──────────────────────────────────────────────
  describe('PATCH /api/v1/orgs/:orgId', () => {
    it('updates org name as org_owner', async () => {
      // Fetch current version first
      const getRes = await request(app)
        .get(`/api/v1/orgs/${orgId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      const version = (getRes.body.data as { version: number }).version;

      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'Updated Name', version })
        .expect(200);

      expect(res.body.data.name).toBe('Updated Name');
    });

    it('returns 409 on version conflict', async () => {
      await request(app)
        .patch(`/api/v1/orgs/${orgId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'Conflict Test', version: 1 })  // stale version — org was already updated
        .expect(409);
    });
  });

  // ── GET /api/v1/orgs/:orgId/members ───────────────────────────────────────
  describe('GET /api/v1/orgs/:orgId/members', () => {
    it('returns member list', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/members`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── POST /api/v1/orgs/:orgId/invitations ──────────────────────────────────
  describe('POST /api/v1/orgs/:orgId/invitations', () => {
    it('creates an invitation and returns 201', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ email: `invite+${Date.now()}@example.com`, role: 'member' })
        .expect(201);

      expect(res.body.data).toMatchObject({ status: 'pending', role: 'member' });
    });

    it('returns 400 for invalid role', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ email: 'bad@example.com', role: 'org_owner' })
        .expect(400);
    });
  });

  // ── GET /api/v1/me ─────────────────────────────────────────────────────────
  describe('GET /api/v1/me', () => {
    it('returns user without sensitive fields', async () => {
      const res = await request(app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const user = res.body.data as Record<string, unknown>;
      expect(user).not.toHaveProperty('password_hash');
      expect(user).not.toHaveProperty('totp_secret');
      expect(user).not.toHaveProperty('mfa_backup_codes');
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('email');
    });

    it('returns 401 without JWT', async () => {
      await request(app).get('/api/v1/me').expect(401);
    });
  });
});
