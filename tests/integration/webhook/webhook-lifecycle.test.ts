/**
 * Integration tests for webhook full lifecycle (Phase 3g)
 *
 * Covers:
 * - Create webhook (valid HTTPS URL)
 * - List webhooks
 * - Delete webhook
 * - Rotate secret
 * - Non-owner cannot manage webhooks (403)
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../../src/app';
import { seedUser, seedOrg, getTestJwt } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import { redisClient } from '../../../src/shared/redis/clients';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Webhook Lifecycle', () => {
  let ownerToken: string;
  let orgId: string;
  let memberToken: string;

  beforeAll(async () => {
    const owner = await seedUser();
    const member = await seedUser();

    const org = await seedOrg({ ownerId: owner.userId });
    orgId = org.orgId;

    await queryPrimary(
      `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
       VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())`,
      [orgId, member.userId]
    );

    // Enable webhooks feature flag for this org
    await queryPrimary(
      `INSERT INTO feature_flags (key, description, is_globally_enabled, enabled_org_ids, disabled_org_ids)
       VALUES ('feature.webhooks', 'Webhook subscriptions', false, ARRAY[$1::uuid], ARRAY[]::uuid[])
       ON CONFLICT (key) DO UPDATE
         SET enabled_org_ids = array_append(
           array_remove(feature_flags.enabled_org_ids, $1::uuid),
           $1::uuid
         )`,
      [orgId]
    );
    // Bust the Redis L2 flag cache so the service re-reads from DB
    await redisClient.hdel('featureflags:cache', 'feature.webhooks');

    ownerToken = await getTestJwt(owner.email, owner.password, orgId);
    memberToken = await getTestJwt(member.email, member.password, orgId);
  });

  // ── Create ────────────────────────────────────────────────────────────────

  describe('POST /api/v1/orgs/:orgId/webhooks', () => {
    it('creates a webhook with valid HTTPS URL and returns 201', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/webhooks`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .send({
          url: 'https://example.com/webhook',
          events: ['task.created', 'task.updated'],
        })
        .expect(201);

      // Response shape: { webhook: {...}, secret: '...' }
      expect(res.body.data).toHaveProperty('webhook');
      expect(res.body.data).toHaveProperty('secret');
      expect(res.body.data.webhook).toHaveProperty('id');
      expect(res.body.data.webhook.url).toBe('https://example.com/webhook');
    });

    it('rejects HTTP (non-HTTPS) URL (422)', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/webhooks`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .send({
          url: 'http://example.com/webhook',
          events: ['task.created'],
        })
        .expect(422);
    });

    it('non-admin member cannot create webhook (403)', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/webhooks`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('X-Org-ID', orgId)
        .send({
          url: 'https://example.com/webhook',
          events: ['task.created'],
        })
        .expect(403);
    });
  });

  // ── List ──────────────────────────────────────────────────────────────────

  describe('GET /api/v1/orgs/:orgId/webhooks', () => {
    it('lists all webhooks for org', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/webhooks`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .send({ url: 'https://example.com/wh-list', events: ['task.created'] })
        .expect(201);

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/webhooks`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Rotate secret ─────────────────────────────────────────────────────────

  describe('POST /api/v1/orgs/:orgId/webhooks/:webhookId/rotate-secret', () => {
    it('rotates the webhook secret and returns new secret', async () => {
      const createRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/webhooks`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .send({ url: 'https://example.com/wh-rotate', events: ['task.created'] })
        .expect(201);

      const webhookId = (createRes.body.data as { webhook: { id: string } }).webhook.id;
      const oldSecret = (createRes.body.data as { secret: string }).secret;

      const rotateRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/webhooks/${webhookId}/rotate-secret`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(rotateRes.body.data).toHaveProperty('secret');
      expect(rotateRes.body.data.secret).not.toBe(oldSecret);
    });
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  describe('DELETE /api/v1/orgs/:orgId/webhooks/:webhookId', () => {
    it('deletes a webhook', async () => {
      const createRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/webhooks`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .send({ url: 'https://example.com/wh-delete', events: ['task.deleted'] })
        .expect(201);

      const webhookId = (createRes.body.data as { webhook: { id: string } }).webhook.id;

      await request(app)
        .delete(`/api/v1/orgs/${orgId}/webhooks/${webhookId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      // Webhook should no longer appear in list
      const listRes = await request(app)
        .get(`/api/v1/orgs/${orgId}/webhooks`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      const ids = (listRes.body.data as { id: string }[]).map(w => w.id);
      expect(ids).not.toContain(webhookId);
    });

    it('returns 404 for non-existent webhook', async () => {
      await request(app)
        .delete(`/api/v1/orgs/${orgId}/webhooks/${uuidv4()}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Org-ID', orgId)
        .expect(404);
    });
  });
});
