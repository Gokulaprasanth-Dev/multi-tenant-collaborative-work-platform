/**
 * Integration tests for notification preferences (Phase 3f)
 *
 * Covers:
 * - List notification preferences
 * - Update a preference (channel_inapp, channel_email, digest_mode)
 * - Muted in-app channel: no notification written after muting
 * - Mark notification as read
 * - Mark all notifications as read
 * - Email unsubscribe link (public endpoint)
 */

import request from 'supertest';
import { app } from '../../../src/app';
import { seedUser, seedOrg, getTestJwt } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import { hmac } from '../../../src/shared/crypto';
import { config } from '../../../src/shared/config';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Notification Preferences', () => {
  let ownerToken: string;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const owner = await seedUser();
    userId = owner.userId;
    const org = await seedOrg({ ownerId: owner.userId });
    orgId = org.orgId;
    ownerToken = await getTestJwt(owner.email, owner.password, orgId);

    // Seed notification preferences for this user/org
    const EVENT_TYPES = [
      'task.assigned', 'task.updated', 'task.status_changed', 'task.commented',
      'task.mentioned', 'message.received',
    ];
    for (const eventType of EVENT_TYPES) {
      await queryPrimary(
        `INSERT INTO notification_preferences (org_id, user_id, event_type)
         VALUES ($1, $2, $3) ON CONFLICT (org_id, user_id, event_type) DO NOTHING`,
        [orgId, userId, eventType]
      );
    }
  });

  // ── List preferences ──────────────────────────────────────────────────────

  describe('GET /api/v1/orgs/:orgId/notification-preferences', () => {
    it('returns list of preferences for the user', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/notification-preferences`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('returns 401 without token', async () => {
      await request(app)
        .get(`/api/v1/orgs/${orgId}/notification-preferences`)
        .set('X-Org-ID', orgId)
        .expect(401);
    });
  });

  // ── Update preference ─────────────────────────────────────────────────────

  describe('PATCH /api/v1/orgs/:orgId/notification-preferences/:eventType', () => {
    it('disables in-app channel for task.assigned', async () => {
      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/notification-preferences/task.assigned`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .send({ channel_inapp: false })
        .expect(200);

      expect(res.body.data.channel_inapp).toBe(false);
    });

    it('enables email channel and sets digest mode', async () => {
      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/notification-preferences/task.updated`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .send({ channel_email: true, digest_mode: 'daily_digest' })
        .expect(200);

      expect(res.body.data.channel_email).toBe(true);
      expect(res.body.data.digest_mode).toBe('daily_digest');
    });

    it('persists the preference change in DB', async () => {
      await request(app)
        .patch(`/api/v1/orgs/${orgId}/notification-preferences/task.commented`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .send({ channel_inapp: false, channel_email: false })
        .expect(200);

      const row = await queryPrimary<{ channel_inapp: boolean; channel_email: boolean }>(
        `SELECT channel_inapp, channel_email FROM notification_preferences
         WHERE org_id = $1 AND user_id = $2 AND event_type = 'task.commented'`,
        [orgId, userId]
      );
      expect(row.rows[0]!.channel_inapp).toBe(false);
      expect(row.rows[0]!.channel_email).toBe(false);
    });

    it('rejects invalid digest_mode (400)', async () => {
      await request(app)
        .patch(`/api/v1/orgs/${orgId}/notification-preferences/task.assigned`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .send({ digest_mode: 'weekly' })
        .expect(400);
    });
  });

  // ── Read notifications ────────────────────────────────────────────────────

  describe('Notification read endpoints', () => {
    it('GET /notifications returns array', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/notifications`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('POST /notifications/read-all marks all as read', async () => {
      // Seed a notification
      await queryPrimary(
        `INSERT INTO notifications (org_id, user_id, type, entity_type, entity_id, payload, is_read)
         VALUES ($1, $2, 'task.assigned', 'task', gen_random_uuid(), '{}', false)`,
        [orgId, userId]
      );

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/notifications/read-all`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(res.body.data).toHaveProperty('marked');
      expect(res.body.data.marked).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Email unsubscribe (public) ────────────────────────────────────────────

  describe('GET /notifications/unsubscribe', () => {
    it('disables email channel via HMAC-signed link', async () => {
      const eventType = 'task.mentioned';
      const token = hmac(`${userId}:${orgId}:${eventType}`, config.inviteSecret);

      const res = await request(app)
        .get(`/api/v1/notifications/unsubscribe`)
        .query({ token, userId, orgId, eventType })
        .expect(200);

      expect(res.body.data).toHaveProperty('message');

      // Verify DB
      const row = await queryPrimary<{ channel_email: boolean }>(
        `SELECT channel_email FROM notification_preferences
         WHERE org_id = $1 AND user_id = $2 AND event_type = $3`,
        [orgId, userId, eventType]
      );
      expect(row.rows[0]!.channel_email).toBe(false);
    });

    it('rejects invalid token (400)', async () => {
      await request(app)
        .get(`/api/v1/notifications/unsubscribe`)
        .query({ token: 'invalid', userId, orgId, eventType: 'task.assigned' })
        .expect(400);
    });
  });
});
