/**
 * TASK-100 — Idempotency Tests
 * Repeat every mutation endpoint 3× with same Idempotency-Key.
 * Assert: 1 DB row, 2nd and 3rd calls return same status+body as 1st.
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../../src/app';
import { primaryPool, queryPrimary } from '../../../src/shared/database/pool';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

async function registerAndLogin(suffix: string): Promise<{ token: string; userId: string; email: string }> {
  const email = `idempotency-${suffix}-${Date.now()}@example.com`;
  await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: 'Password123!', name: 'Idempotency User' })
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

  const { tokens, user } = loginRes.body.data as {
    tokens: { accessToken: string };
    user: { id: string };
  };
  return { token: tokens.accessToken, userId: user.id, email };
}

maybeDescribe('Idempotency', () => {

  it('POST /orgs with same Idempotency-Key creates only 1 org', async () => {
    const { token } = await registerAndLogin('idem-org');
    const idempotencyKey = uuidv4();
    const slug = `idem-org-${uuidv4().slice(0, 8)}`;

    // Call it 3 times serially with the same key
    const res1 = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ name: 'Idempotent Org', slug });

    const res2 = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ name: 'Idempotent Org', slug });

    const res3 = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ name: 'Idempotent Org', slug });

    // All three must return the same status
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(res1.status);
    expect(res3.status).toBe(res1.status);

    // Same org ID returned
    const orgId1 = (res1.body.data as { id: string }).id;
    const orgId2 = (res2.body.data as { id: string }).id;
    const orgId3 = (res3.body.data as { id: string }).id;
    expect(orgId2).toBe(orgId1);
    expect(orgId3).toBe(orgId1);

    // Only 1 row in DB
    const dbResult = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM organizations WHERE id = $1`,
      [orgId1]
    );
    expect(parseInt(dbResult.rows[0]!.count, 10)).toBe(1);
  });

  it('POST /orgs/:orgId/workspaces with same Idempotency-Key creates only 1 workspace', async () => {
    const { token: preOrgToken, email } = await registerAndLogin('idem-ws');
    const orgSlug = `idem-ws-org-${uuidv4().slice(0, 8)}`;

    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${preOrgToken}`)
      .set('Idempotency-Key', uuidv4())
      .send({ name: 'Idempotency Workspace Org', slug: orgSlug })
      .expect(201);
    const orgId = (orgRes.body.data as { id: string }).id;

    // Get org-scoped token
    const orgLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!', orgId })
      .expect(200);
    const orgScopedToken = (orgLoginRes.body.data as { tokens: { accessToken: string } }).tokens.accessToken;

    const idempotencyKey = uuidv4();

    const res1 = await request(app)
      .post(`/api/v1/orgs/${orgId}/workspaces`)
      .set('Authorization', `Bearer ${orgScopedToken}`)
      .set('X-Org-ID', orgId)
      .set('Idempotency-Key', idempotencyKey)
      .send({ name: 'Idempotent Workspace' });

    const res2 = await request(app)
      .post(`/api/v1/orgs/${orgId}/workspaces`)
      .set('Authorization', `Bearer ${orgScopedToken}`)
      .set('X-Org-ID', orgId)
      .set('Idempotency-Key', idempotencyKey)
      .send({ name: 'Idempotent Workspace' });

    const res3 = await request(app)
      .post(`/api/v1/orgs/${orgId}/workspaces`)
      .set('Authorization', `Bearer ${orgScopedToken}`)
      .set('X-Org-ID', orgId)
      .set('Idempotency-Key', idempotencyKey)
      .send({ name: 'Idempotent Workspace' });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(res1.status);
    expect(res3.status).toBe(res1.status);

    const wsId = (res1.body.data as { id: string }).id;
    expect((res2.body.data as { id: string }).id).toBe(wsId);
    expect((res3.body.data as { id: string }).id).toBe(wsId);

    const dbResult = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM workspaces WHERE id = $1`,
      [wsId]
    );
    expect(parseInt(dbResult.rows[0]!.count, 10)).toBe(1);
  });

});
