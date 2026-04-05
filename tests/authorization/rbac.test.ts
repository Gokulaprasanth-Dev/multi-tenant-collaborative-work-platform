/**
 * TASK-099 — Authorization and Cross-Tenant Isolation Tests
 *
 * Covers:
 * 1. RBAC matrix: role × action combinations
 * 2. Cross-tenant isolation: user B cannot access org A resources
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../src/app';
import { queryPrimary } from '../../src/shared/database/pool';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

// ─── helpers ────────────────────────────────────────────────────────────────

async function register(suffix: string): Promise<{ token: string; userId: string; email: string }> {
  const email = `rbac-${suffix}-${Date.now()}@example.com`;
  await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: 'Password123!', name: 'RBAC User' })
    .expect(201);

  // Verify email directly in DB (required before login)
  await queryPrimary(
    `UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE email = $1`,
    [email]
  );

  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'Password123!' })
    .expect(200);

  const { tokens, user } = loginRes.body.data as {
    tokens: { accessToken: string };
    user: { id: string };
  };
  return { token: tokens.accessToken, userId: user.id, email };
}

async function createOrg(
  preOrgToken: string,
  email: string,
  slug: string
): Promise<{ orgId: string; orgScopedToken: string }> {
  const res = await request(app)
    .post('/api/v1/orgs')
    .set('Authorization', `Bearer ${preOrgToken}`)
    .set('Idempotency-Key', uuidv4())
    .send({ name: `Org ${slug}`, slug })
    .expect(201);
  const orgId = (res.body.data as { id: string }).id;

  // Re-login with orgId to get org-scoped token
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'Password123!', orgId })
    .expect(200);
  const orgScopedToken = (loginRes.body.data as { tokens: { accessToken: string } }).tokens.accessToken;

  return { orgId, orgScopedToken };
}

async function createWorkspace(orgScopedToken: string, orgId: string): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/orgs/${orgId}/workspaces`)
    .set('Authorization', `Bearer ${orgScopedToken}`)
    .set('X-Org-ID', orgId)
    .set('Idempotency-Key', uuidv4())
    .send({ name: 'Test Workspace' })
    .expect(201);
  return (res.body.data as { id: string }).id;
}

// ─── tests ───────────────────────────────────────────────────────────────────

maybeDescribe('RBAC and Cross-Tenant Isolation', () => {

  // ── Cross-tenant isolation ───────────────────────────────────────────────

  describe('Cross-tenant isolation', () => {
    it('user B cannot GET org A organizations endpoint', async () => {
      const ownerA = await register('owner-a-xt');
      const userB = await register('user-b-xt');

      const { orgId: orgAId } = await createOrg(ownerA.token, ownerA.email, `cross-a-${Date.now()}`);

      // User B sets X-Org-ID to org A but has a token for a different org — should get 403
      const res = await request(app)
        .get(`/api/v1/orgs/${orgAId}/workspaces`)
        .set('Authorization', `Bearer ${userB.token}`)
        .set('X-Org-ID', orgAId);

      expect([403, 404]).toContain(res.status);
    });

    it('search returns 0 results for org B user searching org A data', async () => {
      const ownerA = await register('search-owner-a');
      const userB = await register('search-user-b');

      const { orgId: orgAId, orgScopedToken: tokenA } = await createOrg(ownerA.token, ownerA.email, `search-org-a-${Date.now()}`);
      await createOrg(userB.token, userB.email, `search-org-b-${Date.now()}`);

      // Create a task in org A
      const wsId = await createWorkspace(tokenA, orgAId);
      await request(app)
        .post(`/api/v1/orgs/${orgAId}/workspaces/${wsId}/tasks`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Org-ID', orgAId)
        .set('Idempotency-Key', uuidv4())
        .send({ title: 'Secret Task from Org A' });

      // User B searches org A — must not see org A's tasks
      const res = await request(app)
        .get(`/api/v1/orgs/${orgAId}/search?q=Secret+Task`)
        .set('Authorization', `Bearer ${userB.token}`)
        .set('X-Org-ID', orgAId);

      // Either 403/404 (not member / token mismatch) or empty results
      if (res.status === 200) {
        const results = (res.body.data as { results: unknown[] }).results;
        expect(results).toHaveLength(0);
      } else {
        expect([403, 404]).toContain(res.status);
      }
    });
  });

  // ── RBAC — task operations ────────────────────────────────────────────────

  describe('RBAC — task operations', () => {
    it('unauthenticated user gets 401 on task creation', async () => {
      await request(app)
        .post('/api/v1/orgs/00000000-0000-0000-0000-000000000001/tasks')
        .set('X-Org-ID', '00000000-0000-0000-0000-000000000001')
        .send({ title: 'Should fail', workspace_id: '00000000-0000-0000-0000-000000000002' })
        .expect(401);
    });

    it('org owner can create a task', async () => {
      const owner = await register('rbac-owner-task');
      const { orgId, orgScopedToken } = await createOrg(owner.token, owner.email, `rbac-owner-${Date.now()}`);
      const wsId = await createWorkspace(orgScopedToken, orgId);

      await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks`)
        .set('Authorization', `Bearer ${orgScopedToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ title: 'Owner Task', workspace_id: wsId })
        .expect(201);
    });
  });

  // ── RBAC — webhook management (org_owner / org_admin only) ───────────────

  describe('RBAC — webhook management', () => {
    it('unauthenticated user gets 401 on webhook listing', async () => {
      await request(app)
        .get('/api/v1/orgs/00000000-0000-0000-0000-000000000001/webhooks')
        .set('X-Org-ID', '00000000-0000-0000-0000-000000000001')
        .expect(401);
    });

    it('non-member gets 403/404 on webhook listing', async () => {
      const owner = await register('rbac-wh-owner');
      const nonMember = await register('rbac-wh-nonmember');
      const { orgId } = await createOrg(owner.token, owner.email, `rbac-wh-${Date.now()}`);

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/webhooks`)
        .set('Authorization', `Bearer ${nonMember.token}`)
        .set('X-Org-ID', orgId);

      expect([403, 404]).toContain(res.status);
    });
  });

  // ── RBAC — billing / subscription (org_owner only) ───────────────────────

  describe('RBAC — billing', () => {
    it('unauthenticated user gets 401 on subscription endpoint', async () => {
      await request(app)
        .get('/api/v1/orgs/00000000-0000-0000-0000-000000000001/subscription')
        .set('X-Org-ID', '00000000-0000-0000-0000-000000000001')
        .expect(401);
    });

    it('non-member gets 403/404 on subscription endpoint', async () => {
      const owner = await register('rbac-billing-owner');
      const nonMember = await register('rbac-billing-nonmember');
      const { orgId } = await createOrg(owner.token, owner.email, `rbac-billing-${Date.now()}`);

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/subscription`)
        .set('Authorization', `Bearer ${nonMember.token}`)
        .set('X-Org-ID', orgId);

      expect([403, 404]).toContain(res.status);
    });
  });

  // ── RBAC — admin only actions ─────────────────────────────────────────────

  describe('RBAC — platform admin endpoints', () => {
    it('non-admin user gets 403 on admin org listing', async () => {
      const user = await register('rbac-non-admin');

      const res = await request(app)
        .get('/api/v1/admin/organizations')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(403);

      expect(res.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
    });
  });

});
