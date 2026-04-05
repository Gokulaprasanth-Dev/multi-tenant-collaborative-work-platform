/**
 * Integration tests for workspace management (Phase 3c)
 *
 * Covers:
 * - Create workspace
 * - List workspaces
 * - Get single workspace
 * - Rename workspace (PATCH with version)
 * - Archive workspace (status change)
 * - Delete workspace (soft-delete)
 * - Tasks in soft-deleted workspace remain in DB
 * - Optimistic locking (stale version rejected)
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../../src/app';
import { seedUser, seedOrg, getTestJwt } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Workspace Management', () => {
  let ownerToken: string;
  let orgId: string;
  let ownerId: string;

  beforeAll(async () => {
    const owner = await seedUser();
    ownerId = owner.userId;
    const org = await seedOrg({ ownerId: owner.userId });
    orgId = org.orgId;
    ownerToken = await getTestJwt(owner.email, owner.password, orgId);
  });

  // ── Create ────────────────────────────────────────────────────────────────

  describe('POST /api/v1/orgs/:orgId/workspaces', () => {
    it('creates a workspace and returns 201', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/workspaces`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'New Workspace' })
        .expect(201);

      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.name).toBe('New Workspace');
      expect(res.body.data.status).toBe('active');
    });

    it('rejects missing name (400)', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/workspaces`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({})
        .expect(400);
    });
  });

  // ── List ──────────────────────────────────────────────────────────────────

  describe('GET /api/v1/orgs/:orgId/workspaces', () => {
    it('lists all workspaces for an org', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/workspaces`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Get single ────────────────────────────────────────────────────────────

  describe('GET /api/v1/orgs/:orgId/workspaces/:workspaceId', () => {
    it('returns a single workspace', async () => {
      const createRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/workspaces`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'Single WS' })
        .expect(201);

      const wsId = (createRes.body.data as { id: string }).id;

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/workspaces/${wsId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(res.body.data.id).toBe(wsId);
      expect(res.body.data.name).toBe('Single WS');
    });

    it('returns 404 for non-existent workspace', async () => {
      await request(app)
        .get(`/api/v1/orgs/${orgId}/workspaces/${uuidv4()}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(404);
    });
  });

  // ── Update (rename / archive) ─────────────────────────────────────────────

  describe('PATCH /api/v1/orgs/:orgId/workspaces/:workspaceId', () => {
    it('renames a workspace', async () => {
      const createRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/workspaces`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'Old Name' })
        .expect(201);

      const ws = createRes.body.data as { id: string; version: number };

      const patchRes = await request(app)
        .patch(`/api/v1/orgs/${orgId}/workspaces/${ws.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .send({ name: 'New Name', version: ws.version })
        .expect(200);

      expect(patchRes.body.data.name).toBe('New Name');
      expect(patchRes.body.data.version).toBe(ws.version + 1);
    });

    it('archives a workspace (status → archived)', async () => {
      const createRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/workspaces`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'To Archive' })
        .expect(201);

      const ws = createRes.body.data as { id: string; version: number };

      const patchRes = await request(app)
        .patch(`/api/v1/orgs/${orgId}/workspaces/${ws.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .send({ status: 'archived', version: ws.version })
        .expect(200);

      expect(patchRes.body.data.status).toBe('archived');
    });

    it('rejects stale version (409 or 400)', async () => {
      const createRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/workspaces`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'Version WS' })
        .expect(201);

      const ws = createRes.body.data as { id: string; version: number };

      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/workspaces/${ws.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .send({ name: 'Conflict', version: ws.version - 1 });

      expect([400, 409]).toContain(res.status);
    });

    it('rejects update without version (400)', async () => {
      const createRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/workspaces`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'No Version WS' })
        .expect(201);

      const wsId = (createRes.body.data as { id: string }).id;

      await request(app)
        .patch(`/api/v1/orgs/${orgId}/workspaces/${wsId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .send({ name: 'No Version' })
        .expect(400);
    });
  });

  // ── Delete (soft) ─────────────────────────────────────────────────────────

  describe('DELETE /api/v1/orgs/:orgId/workspaces/:workspaceId', () => {
    it('soft-deletes a workspace', async () => {
      const createRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/workspaces`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'To Delete' })
        .expect(201);

      const wsId = (createRes.body.data as { id: string }).id;

      await request(app)
        .delete(`/api/v1/orgs/${orgId}/workspaces/${wsId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      // Row still exists in DB with deleted_at set
      const row = await queryPrimary<{ deleted_at: string | null }>(
        `SELECT deleted_at FROM workspaces WHERE id = $1`,
        [wsId]
      );
      expect(row.rows[0]!.deleted_at).not.toBeNull();
    });

    it('tasks in soft-deleted workspace remain in DB', async () => {
      const wsRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/workspaces`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ name: 'WS With Tasks' })
        .expect(201);

      const wsId = (wsRes.body.data as { id: string }).id;

      // Create a task in this workspace
      const taskRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ title: 'Orphaned Task', workspace_id: wsId })
        .expect(201);

      const taskId = (taskRes.body.data as { id: string }).id;

      // Delete the workspace
      await request(app)
        .delete(`/api/v1/orgs/${orgId}/workspaces/${wsId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      // Task row still exists
      const taskRow = await queryPrimary<{ id: string }>(
        `SELECT id FROM tasks WHERE id = $1`,
        [taskId]
      );
      expect(taskRow.rows[0]!.id).toBe(taskId);
    });

    it('returns 404 for non-existent workspace', async () => {
      await request(app)
        .delete(`/api/v1/orgs/${orgId}/workspaces/${uuidv4()}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(404);
    });
  });
});
