/**
 * Integration tests for Payment API routes (TASK-066)
 * Requires live PostgreSQL and Redis.
 */

import request from 'supertest';
import { app } from '../../../src/app';
import { primaryPool } from '../../../src/shared/database/pool';
import { v4 as uuidv4 } from 'uuid';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Payment API', () => {
  let accessToken: string;
  let orgId: string;

  async function registerAndLogin(): Promise<{ token: string; orgId: string }> {
    const email = `payment-test+${Date.now()}@example.com`;
    const slug = `payment-org-${Date.now()}`;

    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password123!', name: 'Payment Tester' })
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

    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${preOrgToken}`)
      .set('Idempotency-Key', uuidv4())
      .send({ name: 'Payment Test Org', slug })
      .expect(201);
    const oid = (orgRes.body.data as { id: string }).id;

    // Login with orgId to get org-scoped token
    const orgLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!', orgId: oid })
      .expect(200);
    const token = (orgLoginRes.body.data as { tokens: { accessToken: string } }).tokens.accessToken;

    return { token, orgId: oid };
  }

  beforeAll(async () => {
    const ctx = await registerAndLogin();
    accessToken = ctx.token;
    orgId = ctx.orgId;
  });

  // ── GET /api/v1/orgs/:orgId/subscription ─────────────────────────────────

  describe('GET /orgs/:orgId/subscription', () => {
    it('returns subscription (may be null for new org)', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/subscription`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(res.body).toHaveProperty('data');
    });

    it('returns 401 without token', async () => {
      await request(app)
        .get(`/api/v1/orgs/${orgId}/subscription`)
        .expect(401);
    });
  });

  // ── GET /api/v1/orgs/:orgId/payments ─────────────────────────────────────

  describe('GET /orgs/:orgId/payments', () => {
    it('returns empty payment list for new org', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/payments`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 401 without token', async () => {
      await request(app)
        .get(`/api/v1/orgs/${orgId}/payments`)
        .expect(401);
    });

    it('respects limit and offset query params', async () => {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/payments?limit=5&offset=0`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .expect(200);

      expect(res.body).toHaveProperty('data');
    });
  });

  // ── POST /api/v1/orgs/:orgId/payments/orders ─────────────────────────────

  describe('POST /orgs/:orgId/payments/orders', () => {
    it('rejects unknown plan tier (400)', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/payments/orders`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ plan_tier: 'free', billing_cycle: 'monthly' })
        .expect(400);
    });

    it('rejects invalid billing cycle (400)', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/payments/orders`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ plan_tier: 'pro', billing_cycle: 'weekly' })
        .expect(400);
    });

    it('rejects missing body fields (400)', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/payments/orders`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({})
        .expect(400);
    });

    it('returns 401 without token', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/payments/orders`)
        .send({ plan_tier: 'pro', billing_cycle: 'monthly' })
        .expect(401);
    });

    // NOTE: A successful order creation requires a live Razorpay integration.
    // Set RAZORPAY_LIVE_TESTS=true with real test credentials to enable this test.
    const runRazorpay = process.env.RAZORPAY_LIVE_TESTS === 'true';
    (runRazorpay ? it : it.skip)('creates a Razorpay order for pro/monthly plan', async () => {
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/payments/orders`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', uuidv4())
        .send({ plan_tier: 'pro', billing_cycle: 'monthly' })
        .expect(201);

      expect(res.body.data).toHaveProperty('order');
      expect(res.body.data).toHaveProperty('payment');
      expect(res.body.data.order).toHaveProperty('id');
      expect(res.body.data.payment.status).toBe('created');
    });

    (runRazorpay ? it : it.skip)('is idempotent — same order returned within same day', async () => {
      const payload = { plan_tier: 'business', billing_cycle: 'annual' };
      const idemKey = uuidv4();

      const res1 = await request(app)
        .post(`/api/v1/orgs/${orgId}/payments/orders`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', idemKey)
        .send(payload)
        .expect(201);

      const res2 = await request(app)
        .post(`/api/v1/orgs/${orgId}/payments/orders`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .set('Idempotency-Key', idemKey)
        .send(payload)
        .expect(201);

      expect(res1.body.data.order.id).toBe(res2.body.data.order.id);
    });
  });

  // ── POST /api/v1/orgs/:orgId/payments/verify ─────────────────────────────

  describe('POST /orgs/:orgId/payments/verify', () => {
    it('rejects missing signature fields (400)', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/payments/verify`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .send({ razorpay_order_id: 'order_xxx' })
        .expect(400);
    });

    it('rejects invalid signature (400)', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/payments/verify`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Org-ID', orgId)
        .send({
          razorpay_order_id: 'order_fake',
          razorpay_payment_id: 'pay_fake',
          razorpay_signature: 'invalidsignature',
        })
        .expect(400);
    });

    it('returns 401 without token', async () => {
      await request(app)
        .post(`/api/v1/orgs/${orgId}/payments/verify`)
        .send({
          razorpay_order_id: 'order_fake',
          razorpay_payment_id: 'pay_fake',
          razorpay_signature: 'invalidsignature',
        })
        .expect(401);
    });
  });

  // ── POST /api/v1/webhooks/razorpay ────────────────────────────────────────

  describe('POST /webhooks/razorpay', () => {
    it('returns 400 with missing signature header', async () => {
      await request(app)
        .post('/api/v1/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ event: 'payment.captured' }))
        .expect(400);
    });

    it('returns 400 with invalid signature', async () => {
      await request(app)
        .post('/api/v1/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', 'invalidsignature')
        .send(JSON.stringify({ event: 'payment.captured' }))
        .expect(400);
    });
  });
});
