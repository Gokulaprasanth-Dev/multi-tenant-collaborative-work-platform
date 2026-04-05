/**
 * Integration tests for org membership management (Phase 3b)
 *
 * Covers:
 * - List members
 * - Change member role
 * - Remove member
 * - Removed member loses access
 * - Non-owner cannot change roles / remove members
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../../src/app';
import { seedUser, seedOrg, getTestJwt } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Org Membership Management', () => {
  let ownerToken: string;
  let orgId: string;
  let memberId: string;
  let memberToken: string;

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
    memberToken = await getTestJwt(member.email, member.password, orgId);
  });

  // ── List members ─────────────────────────────────────────────────────────

  describe('GET /api/v1/orgs/:orgId/members', () => {
    it('returns list of org members', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('returns 401 without token', async () => {
      await request(app)
        .get(`/api/v1/orgs/${orgId}/members`)
        .set('X-Org-ID', orgId)
        .expect(401);
    });
  });

  // ── Change role ───────────────────────────────────────────────────────────

  describe('PATCH /api/v1/orgs/:orgId/members/:userId/role', () => {
    it('org owner can promote member to org_admin', async () => {
      await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/${memberId}/role`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ role: 'org_admin' })
        .expect(200);

      const row = await queryPrimary<{ role: string }>(
        `SELECT role FROM org_memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, memberId]
      );
      expect(row.rows[0]!.role).toBe('org_admin');
    });

    it('org owner can demote org_admin back to member', async () => {
      await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/${memberId}/role`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ role: 'member' })
        .expect(200);

      const row = await queryPrimary<{ role: string }>(
        `SELECT role FROM org_memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, memberId]
      );
      expect(row.rows[0]!.role).toBe('member');
    });

    it('regular member cannot change roles (403)', async () => {
      const otherUser = await seedUser();
      await queryPrimary(
        `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
         VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())`,
        [orgId, otherUser.userId]
      );

      await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/${otherUser.userId}/role`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ role: 'org_admin' })
        .expect(403);
    });

    it('rejects invalid role value (400)', async () => {
      await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/${memberId}/role`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .send({ role: 'superadmin' })
        .expect(400);
    });
  });

  // ── Remove member ─────────────────────────────────────────────────────────

  describe('DELETE /api/v1/orgs/:orgId/members/:userId', () => {
    it('org owner can remove a member', async () => {
      const toRemove = await seedUser();
      await queryPrimary(
        `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
         VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())`,
        [orgId, toRemove.userId]
      );

      await request(app)
        .delete(`/api/v1/orgs/${orgId}/members/${toRemove.userId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      // Membership should be removed or inactive
      const row = await queryPrimary<{ status: string; deleted_at: string | null }>(
        `SELECT status, deleted_at FROM org_memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, toRemove.userId]
      );
      // Either soft-deleted or status changed
      const membership = row.rows[0];
      expect(membership).toBeDefined();
      const isRemoved = membership!.deleted_at !== null || membership!.status !== 'active';
      expect(isRemoved).toBe(true);
    });

    it('removed member loses org-scoped access (403/401)', async () => {
      const toRemove = await seedUser();
      await queryPrimary(
        `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
         VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())`,
        [orgId, toRemove.userId]
      );
      const removedToken = await getTestJwt(toRemove.email, toRemove.password, orgId);

      // Remove the member
      await request(app)
        .delete(`/api/v1/orgs/${orgId}/members/${toRemove.userId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      // Their existing token should now be rejected
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/members`)
        .set('Authorization', `Bearer ${removedToken}`)
        .set('X-Org-ID', orgId);

      expect([401, 403]).toContain(res.status);
    });

    it('regular member cannot remove others (403)', async () => {
      const victim = await seedUser();
      await queryPrimary(
        `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
         VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())`,
        [orgId, victim.userId]
      );

      await request(app)
        .delete(`/api/v1/orgs/${orgId}/members/${victim.userId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('X-Org-ID', orgId)
        .expect(403);
    });
  });
});
