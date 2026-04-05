/**
 * Integration tests for File API routes (TASK-070)
 * Requires live PostgreSQL and Redis.
 */

import request from 'supertest';
import { app } from '../../../src/app';
import { primaryPool } from '../../../src/shared/database/pool';
import { queryPrimary } from '../../../src/shared/database/pool';
import { v4 as uuidv4 } from 'uuid';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('File API', () => {
  let accessToken: string;
  let orgId: string;

  async function registerAndLogin(): Promise<{ token: string; orgId: string }> {
    const email = `file-test+${Date.now()}@example.com`;
    const slug = `file-org-${Date.now()}`;

    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password123!', name: 'File Tester' })
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
      .send({ name: 'File Test Org', slug })
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

  // ── POST /api/v1/orgs/:orgId/files/upload-url — MIME check ───────────────

  describe('POST /orgs/:orgId/files/upload-url', () => {
    it('rejects disallowed MIME type (422)', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files/upload-url`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ filename: 'test.exe', mimeType: 'application/x-msdownload', sizeBytes: 1024 })
        .expect(422);

      expect(res.body.error.code).toBe('INVALID_MIME_TYPE');
    });

    it('rejects missing fields (400)', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/files/upload-url`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ filename: 'test.jpg' })
        .expect(400);
    });

    it('rejects file exceeding plan size limit (422)', async () => {
      const oversizedBytes = 20 * 1024 * 1024; // 20MB — exceeds free plan 10MB limit
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files/upload-url`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ filename: 'big.jpg', mimeType: 'image/jpeg', sizeBytes: oversizedBytes })
        .expect(422);

      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('returns 401 without token', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/files/upload-url`)
        .send({ filename: 'test.jpg', mimeType: 'image/jpeg', sizeBytes: 1024 })
        .expect(401);
    });

    // This test only runs when S3 is configured
    const runS3 = Boolean(process.env.AWS_S3_BUCKET);
    (runS3 ? it : it.skip)('returns uploadUrl and fileId for valid request', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files/upload-url`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ filename: 'test.jpg', mimeType: 'image/jpeg', sizeBytes: 1024 })
        .expect(201);

      expect(res.body.data).toHaveProperty('fileId');
      expect(res.body.data).toHaveProperty('uploadUrl');
      expect(res.body.data).toHaveProperty('expiresAt');
    });
  });

  // ── GET /api/v1/orgs/:orgId/files ─────────────────────────────────────────

  describe('GET /orgs/:orgId/files', () => {
    it('returns file list', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 401 without token', async () => {
      await request(app)
        .get(`/api/v1/orgs/${orgId}/files`)
        .expect(401);
    });
  });

  // ── GET /api/v1/orgs/:orgId/files/:fileId/download-url ────────────────────

  describe('GET /orgs/:orgId/files/:fileId/download-url', () => {
    it('returns 404 for non-existent file', async () => {
      await request(app)
        .get(`/api/v1/orgs/${orgId}/files/00000000-0000-0000-0000-000000000000/download-url`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .expect(404);
    });

    it('returns 401 without token', async () => {
      await request(app)
        .get(`/api/v1/orgs/${orgId}/files/00000000-0000-0000-0000-000000000000/download-url`)
        .expect(401);
    });
  });

  // ── CONSISTENCY-005: scan_status = 'pending' download returns 202 ─────────

  describe('CONSISTENCY-005 fix: scan pending → 202 with Retry-After', () => {
    // This test seeds the DB with a pending-scan file and asserts the response
    // Only run when full integration is available
    it('returns 202 with Retry-After: 30 for pending scan', async () => {
      // Seed a file with scan_status = 'pending' directly in the DB
      const userId = await queryPrimary<{ id: string }>(
        `SELECT id FROM users WHERE id IN (
           SELECT user_id FROM org_memberships WHERE org_id = $1 LIMIT 1
         )`,
        [orgId]
      ).then(r => r.rows[0]!.id);

      const fileId = await queryPrimary<{ id: string }>(
        `INSERT INTO files (org_id, uploader_id, filename, storage_key, mime_type, size_bytes, status, scan_status)
         VALUES ($1, $2, 'pending-scan-test.txt', $3, 'text/plain', 100, 'pending', 'pending')
         RETURNING id`,
        [orgId, userId, uuidv4()]
      ).then(r => r.rows[0]!.id);

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/files/${fileId}/download-url`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId);

      expect(res.status).toBe(202);
      expect(res.headers['retry-after']).toBe('30');

      // Cleanup
      await queryPrimary(`DELETE FROM files WHERE id = $1`, [fileId]);
    });
  });
});
