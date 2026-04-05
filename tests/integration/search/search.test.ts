/**
 * Integration tests for Search API routes (TASK-074)
 * Requires live PostgreSQL and Redis.
 */

import request from 'supertest';
import { app } from '../../../src/app';
import { primaryPool } from '../../../src/shared/database/pool';
import { v4 as uuidv4 } from 'uuid';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Search API', () => {
  let accessToken: string;
  let orgId: string;

  async function registerAndLogin(): Promise<{ token: string; orgId: string }> {
    const email = `search-test+${Date.now()}@example.com`;
    const slug = `search-org-${Date.now()}`;

    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password123!', name: 'Search Tester' })
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
      .send({ name: 'Search Test Org', slug })
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

  // ── GET /api/v1/orgs/:orgId/search ────────────────────────────────────────

  describe('GET /orgs/:orgId/search', () => {
    it('returns empty results for new org', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/search?q=test`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('results');
      expect(Array.isArray(res.body.data.results)).toBe(true);
    });

    it('returns 401 without token', async () => {
      await request(app)
        .get(`/api/v1/orgs/${orgId}/search?q=test`)
        .expect(401);
    });

    it('rejects missing q param (400)', async () => {
      await request(app)
        .get(`/api/v1/orgs/${orgId}/search`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .expect(400);
    });

    it('accepts entity_types filter', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/search?q=test&entity_types=task,file`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(res.body.data).toHaveProperty('results');
    });

    it('accepts limit and offset', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/search?q=test&limit=5&offset=0`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(res.body.data).toHaveProperty('results');
    });
  });

  // ── Unit: TypesenseProvider always includes filter_by ─────────────────────

  describe('TypesenseProvider filter_by assertion', () => {
    it('always includes filter_by: org_id:={orgId} in search params', async () => {
      const { TypesenseProvider } = await import('../../../src/modules/search/typesense.provider');
      const provider = new TypesenseProvider();

      // Mark as initialized to skip network calls
      (provider as unknown as { initialized: boolean }).initialized = true;

      let capturedParams: Record<string, unknown> | undefined;
      const mockSearch = jest.fn().mockImplementation((params: Record<string, unknown>) => {
        capturedParams = params;
        return Promise.resolve({ hits: [], found: 0 });
      });

      // Replace the internal client with a mock
      (provider as unknown as {
        client: {
          collections: (name: string) => {
            documents: () => { search: jest.Mock };
          };
        };
      }).client = {
        collections: (_name: string) => ({
          documents: () => ({ search: mockSearch }),
        }),
      };

      await provider.search({ query: 'test', orgId: 'test-org-id' });

      expect(capturedParams).toBeDefined();
      expect(capturedParams!['filter_by']).toContain('org_id:=test-org-id');
    });
  });
});
