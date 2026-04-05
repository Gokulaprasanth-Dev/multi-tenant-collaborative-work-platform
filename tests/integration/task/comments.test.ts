/**
 * Integration tests for task comments (Phase 3e)
 *
 * Covers:
 * - Create comment
 * - List comments
 * - Delete comment (author succeeds, non-author gets 403)
 * - Nested comment (parent_comment_id)
 * - @mention creates notification entry in DB
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../../src/app';
import { seedUser, seedOrg, getTestJwt } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

// Helper: build a Quill-style rich-text body from plain text
function richText(text: string): Record<string, unknown> {
  return { ops: [{ insert: text }] };
}

maybeDescribe('Task Comments', () => {
  let ownerToken: string;
  let orgId: string;
  let taskId: string;
  let memberId: string;
  let memberToken: string;
  let memberEmailPrefix: string;

  beforeAll(async () => {
    const owner = await seedUser();
    const member = await seedUser();
    memberId = member.userId;
    memberEmailPrefix = member.email.split('@')[0]!;

    const org = await seedOrg({ ownerId: owner.userId });
    orgId = org.orgId;

    await queryPrimary(
      `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
       VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())`,
      [orgId, memberId]
    );

    ownerToken = await getTestJwt(owner.email, owner.password, orgId);
    memberToken = await getTestJwt(member.email, member.password, orgId);

    // Get default workspace
    const ws = await queryPrimary<{ id: string }>(
      `SELECT id FROM workspaces WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );
    const workspaceId = ws.rows[0]!.id;

    // Create task
    const taskRes = await request(app)
      .post(`/api/v1/orgs/${orgId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Org-ID', orgId)
      .set('Idempotency-Key', uuidv4())
      .send({ title: 'Comment Test Task', workspace_id: workspaceId })
      .expect(201);

    taskId = (taskRes.body.data as { id: string }).id;
  });

  // ── Create ────────────────────────────────────────────────────────────────

  describe('POST /api/v1/orgs/:orgId/tasks/:taskId/comments', () => {
    it('creates a comment and returns 201', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: richText('Hello world comment') })
        .expect(201);

      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.body).toEqual(richText('Hello world comment'));
    });

    it('creates a nested reply (parent_comment_id)', async () => {
      const parent = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: richText('Parent comment') })
        .expect(201);

      const parentId = (parent.body.data as { id: string }).id;

      const reply = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: richText('Reply comment'), parent_comment_id: parentId })
        .expect(201);

      expect(reply.body.data.parent_comment_id).toBe(parentId);
    });

    it('returns 401 without token', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: richText('Unauthorized') })
        .expect(401);
    });
  });

  // ── List ──────────────────────────────────────────────────────────────────

  describe('GET /api/v1/orgs/:orgId/tasks/:taskId/comments', () => {
    it('returns list of comments', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: richText('Listed comment') })
        .expect(201);

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  describe('DELETE /api/v1/orgs/:orgId/tasks/:taskId/comments/:commentId', () => {
    it('comment author can delete their own comment', async () => {
      const comment = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: richText('Delete me') })
        .expect(201);

      const commentId = (comment.body.data as { id: string }).id;

      await request(app)
        .delete(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      // Comment should no longer appear in list
      const listRes = await request(app)
        .get(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      const ids = (listRes.body.data as { id: string }[]).map(c => c.id);
      expect(ids).not.toContain(commentId);
    });

    it('non-author member cannot delete another user\'s comment (403)', async () => {
      // Owner creates comment
      const comment = await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: richText('Owner comment') })
        .expect(201);

      const commentId = (comment.body.data as { id: string }).id;

      // Member tries to delete it
      await request(app)
        .delete(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('X-Org-ID', orgId)
        .expect(403);
    });
  });

  // ── @mention notification ─────────────────────────────────────────────────

  describe('@mention in comment body', () => {
    it('creates an outbox event for the mentioned user', async () => {
      // Mention by email prefix (how the service resolves handles)
      const mentionBody = richText(`Hey @${memberEmailPrefix} check this out`);

      await request(app)
        .post(`/api/v1/orgs/${orgId}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: mentionBody })
        .expect(201);

      // The mention service writes to outbox_events
      const row = await queryPrimary<{ id: string }>(
        `SELECT id FROM outbox_events
         WHERE org_id = $1 AND event_type IN ('task.mentioned', 'mention.created')
         ORDER BY occurred_at DESC LIMIT 1`,
        [orgId]
      );

      expect(row.rows.length).toBeGreaterThanOrEqual(1);
    });
  });
});
