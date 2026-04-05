/**
 * Integration tests for Webhook API routes (TASK-083)
 * Requires live PostgreSQL and Redis.
 */

import request from 'supertest';
import { app } from '../../../src/app';
import { primaryPool } from '../../../src/shared/database/pool';
import { v4 as uuidv4 } from 'uuid';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Webhook API', () => {
  let accessToken: string;
  let orgId: string;

  async function registerAndLogin(): Promise<{ token: string; orgId: string }> {
    const email = `webhook-test+${Date.now()}@example.com`;
    const slug = `webhook-org-${Date.now()}`;

    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password123!', name: 'Webhook Tester' })
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

    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${preOrgToken}`)
      .set('Idempotency-Key', uuidv4())
      .send({ name: 'Webhook Test Org', slug })
      .expect(201);
    const oid = (orgRes.body.data as { id: string }).id;

    // Login with orgId to get org-scoped token
    const orgLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!', orgId: oid })
      .expect(200);
    const token = (orgLoginRes.body.data as { tokens: { accessToken: string } }).tokens.accessToken;

    return { token, orgId: oid };
  }

  beforeAll(async () => {
    const ctx = await registerAndLogin();
    accessToken = ctx.token;
    orgId = ctx.orgId;
  });

  // ── POST /api/v1/orgs/:orgId/webhooks ─────────────────────────────────────

  describe('POST /orgs/:orgId/webhooks', () => {
    it('rejects non-HTTPS URLs (422)', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/webhooks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ url: 'http://example.com/hook', events: ['task.created'] })
        .expect(422);

      expect(res.body.error.code).toBe('INVALID_WEBHOOK_URL');
    });

    it('rejects private IP URLs (422)', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/webhooks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ url: 'https://192.168.1.1/hook', events: ['task.created'] })
        .expect(422);

      expect(res.body.error.code).toBe('INVALID_WEBHOOK_URL');
    });

    it('rejects missing url (400)', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/webhooks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ events: ['task.created'] })
        .expect(400);
    });

    it('rejects empty events array (400)', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/webhooks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ url: 'https://example.com/hook', events: [] })
        .expect(400);
    });

    it('returns 401 without token', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/webhooks`)
        .send({ url: 'https://example.com/hook', events: ['task.created'] })
        .expect(401);
    });
  });

  // ── GET /api/v1/orgs/:orgId/webhooks ──────────────────────────────────────

  describe('GET /orgs/:orgId/webhooks', () => {
    it('returns empty list for new org', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/webhooks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 401 without token', async () => {
      await request(app)
        .get(`/api/v1/orgs/${orgId}/webhooks`)
        .expect(401);
    });
  });

  // ── DELETE & rotate ────────────────────────────────────────────────────────

  describe('DELETE /orgs/:orgId/webhooks/:webhookId', () => {
    it('returns 404 for non-existent webhook', async () => {
      await request(app)
        .delete(`/api/v1/orgs/${orgId}/webhooks/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .expect(404);
    });
  });

  describe('POST /orgs/:orgId/webhooks/:webhookId/rotate-secret', () => {
    it('returns 404 for non-existent webhook', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/webhooks/00000000-0000-0000-0000-000000000000/rotate-secret`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .expect(404);
    });
  });
});
