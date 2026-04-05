/**
 * Integration tests for Chat API routes (TASK-056)
 * Requires live PostgreSQL and Redis.
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../../src/app';
import { primaryPool } from '../../../src/shared/database/pool';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Chat API', () => {
  let tokenA: string;
  let tokenB: string;
  let userAId: string;
  let userBId: string;
  let orgId: string;
  let channelId: string;

  async function registerAndLogin(suffix: string): Promise<{ token: string; userId: string; email: string }> {
    const email = `chat+${suffix}+${Date.now()}@example.com`;
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password123!', name: `Chat User ${suffix}` })
      .expect(201);
    const userId = (reg.body.data as { id: string }).id;

    // Verify email directly in DB
    await primaryPool.query(
      `UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE email = $1`,
      [email]
    );

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    const token = (login.body.data as { tokens: { accessToken: string } }).tokens.accessToken;
    return { token, userId, email };
  }

  async function loginWithOrg(email: string, password: string, _orgId: string): Promise<string> {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password, orgId: _orgId })
      .expect(200);
    return (res.body.data as { tokens: { accessToken: string } }).tokens.accessToken;
  }

  beforeAll(async () => {
    const a = await registerAndLogin('a');
    userAId = a.userId;

    const b = await registerAndLogin('b');
    tokenB = b.token;
    userBId = b.userId;

    // Create org with user A (pre-org token)
    const slug = `chat-org-${Date.now()}`;
    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${a.token}`)
      .set('Idempotency-Key', uuidv4())
      .send({ name: 'Chat Test Org', slug })
      .expect(201);
    orgId = (orgRes.body.data as { id: string }).id;

    // Get org-scoped token for user A
    tokenA = await loginWithOrg(a.email, 'Password123!', orgId);

    // Add user B directly to org membership (bypass invitation email flow for tests)
    await primaryPool.query(
      `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
       VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [orgId, userBId]
    );

    // Get org-scoped token for user B
    tokenB = await loginWithOrg(b.email, 'Password123!', orgId);
  });

  // ── Direct channel ────────────────────────────────────────────────────────

  describe('POST /api/v1/orgs/:orgId/channels/direct', () => {
    it('creates a direct channel and returns 201', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/channels/direct`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ other_user_id: userBId })
        .expect(201);

      expect(res.body.data).toMatchObject({ type: 'direct' });
      channelId = (res.body.data as { id: string }).id;
    });

    it('returns 400 CANNOT_DM_SELF when other_user_id equals own user id', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/channels/direct`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ other_user_id: userAId })
        .expect(400);

      expect(res.body.error?.code).toBe('CANNOT_DM_SELF');
    });

    it('returns existing channel (200) on duplicate request — no 409', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/channels/direct`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ other_user_id: userBId })
        .expect(200);

      expect((res.body.data as { id: string }).id).toBe(channelId);
    });
  });

  // ── Messages ──────────────────────────────────────────────────────────────

  describe('POST /api/v1/orgs/:orgId/channels/:channelId/messages', () => {
    it('sends a message and returns 201 with sequence number', async () => {
      const clientMessageId = uuidv4();
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/channels/${channelId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: 'Hello!', client_message_id: clientMessageId })
        .expect(201);

      expect(res.body.data).toMatchObject({
        channel_id: channelId,
        body: 'Hello!',
        client_message_id: clientMessageId,
      });
      expect(Number(res.body.data.sequence_number)).toBeGreaterThanOrEqual(1);
    });

    it('returns existing message for duplicate client_message_id (idempotency)', async () => {
      const clientMessageId = uuidv4();
      const first = await request(app)
        .post(`/api/v1/orgs/${orgId}/channels/${channelId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: 'Dedup test', client_message_id: clientMessageId })
        .expect(201);

      const second = await request(app)
        .post(`/api/v1/orgs/${orgId}/channels/${channelId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: 'Dedup test', client_message_id: clientMessageId });

      expect((second.body.data as { id: string }).id).toBe((first.body.data as { id: string }).id);
    });

    it('two concurrent sends produce distinct sequence numbers', async () => {
      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/api/v1/orgs/${orgId}/channels/${channelId}/messages`)
          .set('Authorization', `Bearer ${tokenA}`)
          .set('X-Org-ID', orgId)
          .set('Idempotency-Key', uuidv4())
          .send({ body: 'Concurrent A', client_message_id: uuidv4() }),
        request(app)
          .post(`/api/v1/orgs/${orgId}/channels/${channelId}/messages`)
          .set('Authorization', `Bearer ${tokenA}`)
          .set('X-Org-ID', orgId)
          .set('Idempotency-Key', uuidv4())
          .send({ body: 'Concurrent B', client_message_id: uuidv4() }),
      ]);

      const seq1 = Number(res1.body.data.sequence_number);
      const seq2 = Number(res2.body.data.sequence_number);
      expect(seq1).not.toBe(seq2);
    });

    it('returns 422 for reply-to-reply (threading depth exceeded)', async () => {
      const parentRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/channels/${channelId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: 'Parent', client_message_id: uuidv4() })
        .expect(201);
      const parentId = (parentRes.body.data as { id: string }).id;

      const replyRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/channels/${channelId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: 'Reply', client_message_id: uuidv4(), parent_message_id: parentId })
        .expect(201);
      const replyId = (replyRes.body.data as { id: string }).id;

      await request(app)
        .post(`/api/v1/orgs/${orgId}/channels/${channelId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ body: 'Nested reply', client_message_id: uuidv4(), parent_message_id: replyId })
        .expect(422);
    });

    /**
     * REQUIRED cross-partition threading test (TASK-056 spec).
     * Inserts a parent message with created_at 35 days ago (different partition)
     * and verifies a reply is accepted — proving BUG-NEW-005 fix works.
     */
    it('thread reply to a message from a different calendar month succeeds', async () => {
      const parentResult = await primaryPool.query(
        `INSERT INTO chat_messages (id, org_id, channel_id, sender_id, client_message_id,
           sequence_number, body, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, gen_random_uuid(), 9999999, 'old parent',
           NOW() - INTERVAL '35 days')
         RETURNING id`,
        [orgId, channelId, userAId]
      );
      const oldParentId = (parentResult.rows[0] as { id: string }).id;

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/channels/${channelId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({
          body: 'Reply to old message',
          client_message_id: uuidv4(),
          parent_message_id: oldParentId,
        })
        .expect(201);

      expect((res.body.data as { parent_message_id: string }).parent_message_id).toBe(oldParentId);
    });
  });

  // ── List messages ─────────────────────────────────────────────────────────

  describe('GET /api/v1/orgs/:orgId/channels/:channelId/messages', () => {
    it('returns messages in ascending sequence order', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/channels/${channelId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      const msgs = res.body.data as Array<{ sequence_number: string }>;
      expect(Array.isArray(msgs)).toBe(true);
      for (let i = 1; i < msgs.length; i++) {
        expect(Number(msgs[i]!.sequence_number)).toBeGreaterThan(Number(msgs[i - 1]!.sequence_number));
      }
    });

    it('returns 401 for non-member (no org-scoped token)', async () => {
      const outsider = await registerAndLogin('outsider');
      // Non-members can't get org-scoped tokens, so they get 401 (missing X-Org-ID or mismatch)
      await request(app)
        .get(`/api/v1/orgs/${orgId}/channels/${channelId}/messages`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(401);
    });
  });
});
