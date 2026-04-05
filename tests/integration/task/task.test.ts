/**
 * Integration tests for Task API routes (TASK-053)
 * Requires live PostgreSQL and Redis.
 */

import request from 'supertest';
import { app } from '../../../src/app';
import { primaryPool } from '../../../src/shared/database/pool';
import { v4 as uuidv4 } from 'uuid';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Task API', () => {
  let accessToken: string;
  let orgId: string;
  let workspaceId: string;

  async function registerAndLogin(): Promise<{ token: string; orgId: string; workspaceId: string }> {
    const email = `task-test+${Date.now()}@example.com`;
    const slug = `task-org-${Date.now()}`;

    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password123!', name: 'Task Tester' })
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
      .send({ name: 'Task Test Org', slug })
      .expect(201);
    const _orgId = (orgRes.body.data as { id: string }).id;

    // Login with orgId to get org-scoped token
    const orgLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!', orgId: _orgId })
      .expect(200);
    const token = (orgLoginRes.body.data as { tokens: { accessToken: string } }).tokens.accessToken;

    // Get default workspace
    const wsRes = await request(app)
      .get(`/api/v1/orgs/${_orgId}/workspaces`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-ID', _orgId)
      .expect(200);
    const _workspaceId = ((wsRes.body.data as Array<{ id: string }>)[0] ?? { id: '' }).id;

    return { token, orgId: _orgId, workspaceId: _workspaceId };
  }

  beforeAll(async () => {
    const ctx = await registerAndLogin();
    accessToken = ctx.token;
    orgId = ctx.orgId;
    workspaceId = ctx.workspaceId;
  });

  // ── Task CRUD ─────────────────────────────────────────────────────────────

  describe('POST /api/v1/orgs/:orgId/tasks', () => {
    it('creates a task and returns 201', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ workspace_id: workspaceId, title: 'Test Task', priority: 'high' })
        .expect(201);

      expect(res.body.data).toMatchObject({ title: 'Test Task', status: 'todo', priority: 'high' });
    });

    it('returns 422 for child of depth-2 task (TASK_DEPTH_EXCEEDED)', async () => {
      // Create depth-0 task
      const d0 = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ workspace_id: workspaceId, title: 'Depth 0' })
        .expect(201);
      const d0Id = (d0.body.data as { id: string }).id;

      // Create depth-1 task
      const d1 = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ workspace_id: workspaceId, title: 'Depth 1', parent_task_id: d0Id })
        .expect(201);
      const d1Id = (d1.body.data as { id: string }).id;

      // Create depth-2 task
      const d2 = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ workspace_id: workspaceId, title: 'Depth 2', parent_task_id: d1Id })
        .expect(201);
      const d2Id = (d2.body.data as { id: string }).id;

      // Attempt depth-3 — must fail
      await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ workspace_id: workspaceId, title: 'Depth 3', parent_task_id: d2Id })
        .expect(422);
    });
  });

  describe('PATCH /api/v1/orgs/:orgId/tasks/:taskId', () => {
    let taskId: string;
    let taskVersion: number;

    beforeAll(async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ workspace_id: workspaceId, title: 'Update Test Task' })
        .expect(201);
      taskId = (res.body.data as { id: string }).id;
      taskVersion = (res.body.data as { version: number }).version;
    });

    it('updates status to in_progress', async () => {
      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ status: 'in_progress', version: taskVersion })
        .expect(200);

      expect(res.body.data.status).toBe('in_progress');
      taskVersion = (res.body.data as { version: number }).version;
    });

    it('returns 409 on version conflict', async () => {
      await request(app)
        .patch(`/api/v1/orgs/${orgId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ title: 'Conflict', version: 1 })  // stale version
        .expect(409);
    });

    it('returns 422 for invalid status transition (done → in_review)', async () => {
      // First get to done
      await request(app)
        .patch(`/api/v1/orgs/${orgId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ status: 'in_review', version: taskVersion })
        .expect(200);

      const doneRes = await request(app)
        .patch(`/api/v1/orgs/${orgId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ status: 'done', version: taskVersion + 1 })
        .expect(200);
      const doneVersion = (doneRes.body.data as { version: number }).version;

      // Now try invalid transition done → in_review
      await request(app)
        .patch(`/api/v1/orgs/${orgId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ status: 'in_review', version: doneVersion })
        .expect(422);
    });
  });

  // ── Dependencies ──────────────────────────────────────────────────────────

  describe('Task dependencies', () => {
    let taskA: string;
    let taskB: string;

    beforeAll(async () => {
      const aRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ workspace_id: workspaceId, title: 'Task A' })
        .expect(201);
      const bRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ workspace_id: workspaceId, title: 'Task B' })
        .expect(201);
      taskA = (aRes.body.data as { id: string }).id;
      taskB = (bRes.body.data as { id: string }).id;
    });

    it('adds A→B dependency', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskA}/dependencies`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ blocked_task_id: taskB })
        .expect(201);

      expect(res.body.data).toMatchObject({ blocking_task_id: taskA, blocked_task_id: taskB });
    });

    it('returns 422 for self-dependency', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskA}/dependencies`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ blocked_task_id: taskA })
        .expect(422);
    });

    it('returns 422 for cycle (B→A when A→B exists)', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskB}/dependencies`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ blocked_task_id: taskA })
        .expect(422);
    });
  });

  // ── Bulk operations ───────────────────────────────────────────────────────

  describe('Bulk status update', () => {
    it('updates 5 tasks atomically', async () => {
      const taskIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post(`/api/v1/orgs/${orgId}/tasks`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Org-ID', orgId)
          .set('Idempotency-Key', uuidv4())
          .send({ workspace_id: workspaceId, title: `Bulk Task ${i}` })
          .expect(201);
        taskIds.push((res.body.data as { id: string }).id);
      }

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/bulk/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ task_ids: taskIds, status: 'in_progress' })
        .expect(200);

      expect((res.body.data as { updated: number }).updated).toBe(5);
    });
  });

  // ── Comments ──────────────────────────────────────────────────────────────

  describe('Comments', () => {
    let taskId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ workspace_id: workspaceId, title: 'Comment Test Task' })
        .expect(201);
      taskId = (res.body.data as { id: string }).id;
    });

    it('creates a comment', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: { ops: [{ insert: 'Hello @testuser world' }] } })
        .expect(201);

      expect(res.body.data).toMatchObject({ task_id: taskId });
    });

    it('returns 422 when nesting reply under a reply', async () => {
      const parent = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: { ops: [{ insert: 'Parent comment' }] } })
        .expect(201);
      const parentId = (parent.body.data as { id: string }).id;

      const reply = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: { ops: [{ insert: 'Reply' }] }, parent_comment_id: parentId })
        .expect(201);
      const replyId = (reply.body.data as { id: string }).id;

      await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: { ops: [{ insert: 'Nested reply' }] }, parent_comment_id: replyId })
        .expect(422);
    });
  });
});
