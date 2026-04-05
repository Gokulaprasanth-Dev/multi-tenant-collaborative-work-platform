/**
 * Integration tests for notification list pagination (Phase 3h)
 *
 * Covers:
 * - limit/offset for GET /notifications
 * - only_unread filter
 * - limit capped at 200 (schema enforces)
 * - limit/offset for GET /tasks/:taskId/activity
 */

import request from 'supertest';
import { app } from '../../../src/app';
import { seedUser, seedOrg, getTestJwt } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import { v4 as uuidv4 } from 'uuid';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Pagination Edge Cases', () => {
  let token: string;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const owner = await seedUser();
    userId = owner.userId;
    const org = await seedOrg({ ownerId: owner.userId });
    orgId = org.orgId;
    token = await getTestJwt(owner.email, owner.password, orgId);

    // Seed 5 unread notifications
    for (let i = 0; i < 5; i++) {
      await queryPrimary(
        `INSERT INTO notifications (org_id, user_id, type, entity_type, entity_id, payload, is_read)
         VALUES ($1, $2, 'task.assigned', 'task', gen_random_uuid(), '{}', false)`,
        [orgId, userId]
      );
    }
  });

  // ── Notifications pagination ───────────────────────────────────────────────

  describe('GET /api/v1/orgs/:orgId/notifications pagination', () => {
    it('limit=2 returns exactly 2 items', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/notifications?limit=2`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(res.body.data.length).toBe(2);
    });

    it('offset skips earlier items', async () => {
      const all = await request(app)
        .get(`/api/v1/orgs/${orgId}/notifications?limit=5`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      const page2 = await request(app)
        .get(`/api/v1/orgs/${orgId}/notifications?limit=2&offset=2`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      // Items at page2 should not overlap with first 2
      const allIds = (all.body.data as { id: string }[]).map(n => n.id);
      const firstPageIds = allIds.slice(0, 2);
      const secondPageIds = (page2.body.data as { id: string }[]).map(n => n.id);

      for (const id of secondPageIds) {
        expect(firstPageIds).not.toContain(id);
      }
    });

    it('only_unread=true filters to unread items only', async () => {
      // Mark one as read
      await queryPrimary(
        `UPDATE notifications SET is_read = true, read_at = NOW()
         WHERE id = (
           SELECT id FROM notifications
           WHERE org_id = $1 AND user_id = $2 AND is_read = false
           LIMIT 1
         )`,
        [orgId, userId]
      );

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/notifications?unread_only=true`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      const hasRead = (res.body.data as { is_read: boolean }[]).some(n => n.is_read);
      expect(hasRead).toBe(false);
    });

    it('rejects limit > 200 (400)', async () => {
      await request(app)
        .get(`/api/v1/orgs/${orgId}/notifications?limit=201`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-ID', orgId)
        .expect(400);
    });

    it('rejects negative offset (400)', async () => {
      await request(app)
        .get(`/api/v1/orgs/${orgId}/notifications?offset=-1`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-ID', orgId)
        .expect(400);
    });

    it('offset beyond data returns empty array', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/notifications?limit=10&offset=9999`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(0);
    });
  });

  // ── Activity log pagination ────────────────────────────────────────────────

  describe('GET /api/v1/orgs/:orgId/activity pagination', () => {
    let taskId: string;

    beforeAll(async () => {
      // Get workspace
      const ws = await queryPrimary<{ id: string }>(
        `SELECT id FROM workspaces WHERE org_id = $1 LIMIT 1`,
        [orgId]
      );
      const workspaceId = ws.rows[0]!.id;

      // Create task and do multiple status changes to generate activity
      const taskRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ title: 'Pagination Activity Task', workspace_id: workspaceId })
        .expect(201);
      taskId = (taskRes.body.data as { id: string }).id;
      let version = (taskRes.body.data as { version: number }).version;

      // Generate 3 activity entries via status transitions
      const transitions = [
        { status: 'in_progress' },
        { status: 'in_review' },
        { status: 'done' },
      ];
      for (const t of transitions) {
        const r = await request(app)
          .patch(`/api/v1/orgs/${orgId}/tasks/${taskId}`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Org-ID', orgId)
          .set('Idempotency-Key', uuidv4())
          .send({ ...t, version })
          .expect(200);
        version = (r.body.data as { version: number }).version;
      }
    });

    it('limit=1 returns exactly 1 activity entry', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/activity?limit=1`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(res.body.data.length).toBe(1);
    });

    it('offset paginates activity results', async () => {
      const page1 = await request(app)
        .get(`/api/v1/orgs/${orgId}/activity?limit=2&offset=0`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      const page2 = await request(app)
        .get(`/api/v1/orgs/${orgId}/activity?limit=2&offset=2`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      const ids1 = (page1.body.data as { id: string }[]).map(a => a.id);
      const ids2 = (page2.body.data as { id: string }[]).map(a => a.id);
      const overlap = ids1.filter(id => ids2.includes(id));
      expect(overlap).toHaveLength(0);
    });
  });
});
