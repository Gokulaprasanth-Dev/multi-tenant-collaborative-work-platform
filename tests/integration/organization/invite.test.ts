/**
 * Integration tests for invitation flow (Phase 3a)
 *
 * Covers:
 * - Create invitation → accept via token → membership verified
 * - Duplicate pending invite rejected
 * - Revoked invitation rejected on accept (410)
 * - Expired invitation rejected on accept (410)
 * - Accept creates new user account when email doesn't exist
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../../src/app';
import { seedUser, seedOrg, getTestJwt } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

async function getInviteToken(orgId: string): Promise<string> {
  const row = await queryPrimary<{ payload: { token: string } }>(
    `SELECT payload FROM outbox_events
     WHERE org_id = $1 AND event_type = 'invitation.created'
     ORDER BY occurred_at DESC LIMIT 1`,
    [orgId]
  );
  if (!row.rows[0]) throw new Error('No invitation.created outbox event found');
  return (row.rows[0].payload as unknown as { token: string }).token;
}

maybeDescribe('Invitation Flow', () => {
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

  // ── Create invitation ────────────────────────────────────────────────────

  describe('POST /api/v1/orgs/:orgId/invitations', () => {
    it('creates an invitation and returns 201', async () => {
      const email = `invite-${Date.now()}@example.com`;
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ email, role: 'member' })
        .expect(201);

      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.email).toBe(email);
      expect(res.body.data.status).toBe('pending');
    });

    it('rejects duplicate pending invite for same email (409)', async () => {
      const email = `dup-invite-${Date.now()}@example.com`;

      await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ email, role: 'member' })
        .expect(201);

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ email, role: 'member' });

      expect([403, 409]).toContain(res.status);
    });

    it('returns 401 without token', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('X-Org-ID', orgId)
        .send({ email: 'noauth@example.com', role: 'member' })
        .expect(401);
    });
  });

  // ── Accept invitation ────────────────────────────────────────────────────

  describe('POST /api/v1/orgs/invitations/accept', () => {
    it('accepts a valid invitation and returns tokens + userId', async () => {
      const inviteeEmail = `invitee-${Date.now()}@example.com`;

      await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ email: inviteeEmail, role: 'member' })
        .expect(201);

      const token = await getInviteToken(orgId);

      const acceptRes = await request(app)
        .post('/api/v1/orgs/invitations/accept')
        .send({ token })
        .expect(200);

      expect(acceptRes.body.data).toHaveProperty('userId');
      expect(acceptRes.body.data.tokens).toHaveProperty('accessToken');
      expect(acceptRes.body.data.tokens).toHaveProperty('refreshToken');
    });

    it('creates a new user account when invitee email does not exist', async () => {
      const newEmail = `brand-new-${Date.now()}@example.com`;

      await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ email: newEmail, role: 'member' })
        .expect(201);

      const token = await getInviteToken(orgId);

      const acceptRes = await request(app)
        .post('/api/v1/orgs/invitations/accept')
        .send({ token })
        .expect(200);

      const { userId } = acceptRes.body.data as { userId: string };

      // Verify user was created in DB
      const userRow = await queryPrimary<{ email: string; email_verified: boolean }>(
        `SELECT email, email_verified FROM users WHERE id = $1`,
        [userId]
      );
      expect(userRow.rows[0]!.email).toBe(newEmail);
      expect(userRow.rows[0]!.email_verified).toBe(true);

      // Verify membership was created
      const memberRow = await queryPrimary<{ role: string; status: string }>(
        `SELECT role, status FROM org_memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, userId]
      );
      expect(memberRow.rows[0]!.role).toBe('member');
      expect(memberRow.rows[0]!.status).toBe('active');
    });

    it('returns 410 for an already-accepted (used) token', async () => {
      const email = `used-invite-${Date.now()}@example.com`;

      await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ email, role: 'member' })
        .expect(201);

      const token = await getInviteToken(orgId);

      // Accept once
      await request(app)
        .post('/api/v1/orgs/invitations/accept')
        .send({ token })
        .expect(200);

      // Accept again — should fail
      const res = await request(app)
        .post('/api/v1/orgs/invitations/accept')
        .send({ token });

      expect(res.status).toBe(410);
    });

    it('returns 404 for an invalid token', async () => {
      await request(app)
        .post('/api/v1/orgs/invitations/accept')
        .send({ token: 'completely-invalid-token-that-does-not-exist' })
        .expect(404);
    });

    it('returns 410 for a revoked invitation', async () => {
      const email = `revoke-invite-${Date.now()}@example.com`;

      const inviteRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ email, role: 'member' })
        .expect(201);

      const invitationId = (inviteRes.body.data as { id: string }).id;
      const token = await getInviteToken(orgId);

      // Revoke it
      await request(app)
        .delete(`/api/v1/orgs/${orgId}/invitations/${invitationId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      // Try to accept revoked invite
      const res = await request(app)
        .post('/api/v1/orgs/invitations/accept')
        .send({ token });

      expect(res.status).toBe(410);
    });

    it('returns 410 for an expired invitation', async () => {
      const email = `expired-invite-${Date.now()}@example.com`;

      const inviteRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ email, role: 'member' })
        .expect(201);

      const invitationId = (inviteRes.body.data as { id: string }).id;
      const token = await getInviteToken(orgId);

      // Force-expire the invitation in DB
      await queryPrimary(
        `UPDATE invitations SET expires_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
        [invitationId]
      );

      const res = await request(app)
        .post('/api/v1/orgs/invitations/accept')
        .send({ token });

      expect(res.status).toBe(410);
    });
  });
});
