/**
 * Integration tests for task assignees, activity log, and templates (Phase 3d)
 *
 * Covers:
 * Assignees:
 * - Assign user to task via assignee_ids
 * - Unassign (clear assignees)
 * - Assign non-member → 422
 *
 * Activity log:
 * - Status change is recorded in activity log
 * - Activity log is append-only (never shrinks)
 *
 * Templates:
 * - Create template from task data
 * - List templates
 * - Instantiate task from template_id
 * - Delete template
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../../src/app';
import { seedUser, seedOrg, getTestJwt } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Task Assignees, Activity Log, and Templates', () => {
  let ownerToken: string;
  let orgId: string;
  let workspaceId: string;
  let memberId: string;

  beforeAll(async () => {
    const owner = await seedUser();
    const member = await seedUser();
    memberId = member.userId;

    const org = await seedOrg({ ownerId: owner.userId });
    orgId = org.orgId;

    // Add member to org
    await queryPrimary(
      `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
       VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())`,
      [orgId, memberId]
    );

    ownerToken = await getTestJwt(owner.email, owner.password, orgId);

    // Get the default workspace created by seedOrg
    const wsRow = await queryPrimary<{ id: string }>(
      `SELECT id FROM workspaces WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );
    workspaceId = wsRow.rows[0]!.id;
  });

  async function createTask(title = 'Test Task'): Promise<{ id: string; version: number }> {
    const res = await request(app)
      .post(`/api/v1/orgs/${orgId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Org-ID', orgId)
      .set('Idempotency-Key', uuidv4())
      .send({ title, workspace_id: workspaceId })
      .expect(201);
    return res.body.data as { id: string; version: number };
  }

  // ── Assignees ─────────────────────────────────────────────────────────────

  describe('Task Assignees', () => {
    it('assigns a member to a task via assignee_ids', async () => {
      const task = await createTask('Assign Task');

      await request(app)
        .patch(`/api/v1/orgs/${orgId}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ assignee_ids: [memberId], version: task.version })
        .expect(200);

      // Assignees are stored in task_assignees table (not in task row)
      const row = await queryPrimary<{ user_id: string }>(
        `SELECT user_id FROM task_assignees WHERE task_id = $1`,
        [task.id]
      );
      expect(row.rows.map(r => r.user_id)).toContain(memberId);
    });

    it('clears all assignees when assignee_ids is empty array', async () => {
      const task = await createTask('Unassign Task');

      // First assign
      const assigned = await request(app)
        .patch(`/api/v1/orgs/${orgId}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ assignee_ids: [memberId], version: task.version })
        .expect(200);

      // Then clear
      await request(app)
        .patch(`/api/v1/orgs/${orgId}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ assignee_ids: [], version: (assigned.body.data as { version: number }).version })
        .expect(200);

      const row = await queryPrimary<{ user_id: string }>(
        `SELECT user_id FROM task_assignees WHERE task_id = $1`,
        [task.id]
      );
      expect(row.rows).toHaveLength(0);
    });

    it('rejects assigning a non-member on task creation (422)', async () => {
      const outsider = await seedUser(); // not in org

      // Validation only runs on create, not update
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ title: 'Non-member Task', workspace_id: workspaceId, assignee_ids: [outsider.userId] });

      expect([400, 422]).toContain(res.status);
    });
  });

  // ── Activity log ──────────────────────────────────────────────────────────

  describe('Task Activity Log', () => {
    it('GET /api/v1/orgs/:orgId/tasks/:taskId/activity returns entries', async () => {
      const task = await createTask('Activity Task');

      // Update status to generate activity
      await request(app)
        .patch(`/api/v1/orgs/${orgId}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ status: 'in_progress', version: task.version })
        .expect(200);

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/tasks/${task.id}/activity`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('activity log never shrinks (append-only)', async () => {
      const task = await createTask('Append-only Task');

      // Two status changes
      const v1 = await request(app)
        .patch(`/api/v1/orgs/${orgId}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ status: 'in_progress', version: task.version })
        .expect(200);

      await request(app)
        .patch(`/api/v1/orgs/${orgId}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ status: 'done', version: (v1.body.data as { version: number }).version })
        .expect(200);

      const res1 = await request(app)
        .get(`/api/v1/orgs/${orgId}/tasks/${task.id}/activity`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      const count1 = (res1.body.data as unknown[]).length;

      // Fetch again — count must not decrease
      const res2 = await request(app)
        .get(`/api/v1/orgs/${orgId}/tasks/${task.id}/activity`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect((res2.body.data as unknown[]).length).toBeGreaterThanOrEqual(count1);
    });
  });

  // ── Templates ─────────────────────────────────────────────────────────────

  describe('Task Templates', () => {
    it('creates a task template and returns 201', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/task-templates`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'My Template', default_title: 'Template Task' })
        .expect(201);

      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.name).toBe('My Template');
    });

    it('lists templates for org', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/task-templates`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'List Template', default_title: 'Listed' })
        .expect(201);

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/task-templates`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('creates a task with template_id reference', async () => {
      const tmplRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/task-templates`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'Instantiate Template', default_title: 'Template Default' })
        .expect(201);

      const templateId = (tmplRes.body.data as { id: string }).id;

      // title is still required; template_id is stored as a reference
      const taskRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ title: 'Task from Template', workspace_id: workspaceId, template_id: templateId })
        .expect(201);

      expect(taskRes.body.data).toHaveProperty('id');
      expect(taskRes.body.data.template_id).toBe(templateId);
    });

    it('deletes a template', async () => {
      const tmplRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/task-templates`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'Delete Me', default_title: 'Deleted Template Task' })
        .expect(201);

      const templateId = (tmplRes.body.data as { id: string }).id;

      await request(app)
        .delete(`/api/v1/orgs/${orgId}/task-templates/${templateId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      // Should no longer appear in list
      const listRes = await request(app)
        .get(`/api/v1/orgs/${orgId}/task-templates`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      const ids = (listRes.body.data as { id: string }[]).map(t => t.id);
      expect(ids).not.toContain(templateId);
    });
  });
});
