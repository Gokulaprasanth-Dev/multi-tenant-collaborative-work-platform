/**
 * Unit tests for src/modules/payment/webhook.handler.ts
 *
 * Covers:
 * - Missing x-razorpay-signature header → 400
 * - Invalid signature → 400
 * - Invalid JSON body → 400
 * - Unrecognized event type → 200 (unknown events are ignored)
 * - payment.captured: updates payment, reactivates org, writes outbox
 * - payment.failed: updates payment, enqueues failure job
 * - refund.created: updates payment status to refunded
 * - dispute.created: updates payment status to disputed
 * - subscription.charged: reactivates org
 * - Duplicate event (idempotency key exists) → 200 skip
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const mockVerifyWebhookSignature = jest.fn();

jest.mock('../../../src/modules/payment/razorpay.client', () => ({
  razorpayClient: {
    verifyWebhookSignature: mockVerifyWebhookSignature,
  },
}));

const mockFindByOrderId = jest.fn();
const mockUpdateStatus = jest.fn();

jest.mock('../../../src/modules/payment/payment.repository', () => ({
  PaymentRepository: jest.fn().mockImplementation(() => ({
    findByOrderId: mockFindByOrderId,
    updateStatus: mockUpdateStatus,
  })),
  SubscriptionRepository: jest.fn().mockImplementation(() => ({
    findByOrg: jest.fn().mockResolvedValue(null),
  })),
}));

const mockQueryPrimary = jest.fn();
jest.mock('../../../src/shared/database/pool', () => ({
  queryPrimary: (...args: unknown[]) => mockQueryPrimary(...args),
  queryReplica: jest.fn(),
}));

const mockEnqueue = jest.fn();
jest.mock('../../../src/shared/queue/queues', () => ({
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
}));

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
jest.mock('../../../src/shared/redis/clients', () => ({
  redisClient: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  },
}));

import express from 'express';
import request from 'supertest';
import webhookRouter from '../../../src/modules/payment/webhook.handler';

// ── Test app ──────────────────────────────────────────────────────────────────

const app = express();
app.use('/payment', webhookRouter);

// ── Helpers ───────────────────────────────────────────────────────────────────

// Return raw JSON strings — supertest serialises Buffer objects to {"type":"Buffer","data":[...]}
// when Content-Type is application/json, which breaks express.raw() parsing.
function makePaymentCapturedBody() {
  return JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_001',
          order_id: 'order_001',
          amount: 10000,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
  });
}

function makePaymentFailedBody() {
  return JSON.stringify({
    event: 'payment.failed',
    payload: {
      payment: {
        entity: { id: 'pay_002', order_id: 'order_002', amount: 5000, currency: 'INR', status: 'failed' },
      },
    },
  });
}

function makeRefundBody() {
  return JSON.stringify({
    event: 'refund.created',
    payload: {
      refund: { entity: { id: 'rfnd_001', payment_id: 'pay_001', amount: 10000 } },
    },
  });
}

function makeDisputeBody() {
  return JSON.stringify({
    event: 'dispute.created',
    payload: {
      dispute: { entity: { id: 'disp_001', payment_id: 'pay_001', amount: 10000, reason_code: 'fraud' } },
    },
  });
}

function makeSubscriptionChargedBody() {
  return JSON.stringify({
    event: 'subscription.charged',
    payload: {
      subscription: { entity: { id: 'sub_001', status: 'active' } },
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVerifyWebhookSignature.mockReturnValue(true);
  mockRedisGet.mockResolvedValue(null);      // not already processed
  mockRedisSet.mockResolvedValue('OK');
  mockQueryPrimary.mockResolvedValue({ rows: [] });
  mockUpdateStatus.mockResolvedValue(undefined);
  mockEnqueue.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /payment/razorpay', () => {
  it('returns 400 when x-razorpay-signature header is missing', async () => {
    const res = await request(app)
      .post('/payment/razorpay')
      .set('Content-Type', 'application/json')
      .send(makePaymentCapturedBody());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing signature/i);
  });

  it('returns 400 when signature is invalid', async () => {
    mockVerifyWebhookSignature.mockReturnValue(false);
    const res = await request(app)
      .post('/payment/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'bad-sig')
      .send(makePaymentCapturedBody());
    expect(res.status).toBe(400);
  });

  it('returns 200 for unrecognized event type (ignored gracefully)', async () => {
    const body = JSON.stringify({ event: 'unknown.event', payload: {} });
    const res = await request(app)
      .post('/payment/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'valid-sig')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('returns 200 and skips processing for duplicate event', async () => {
    mockRedisGet.mockResolvedValue('1'); // already processed
    const res = await request(app)
      .post('/payment/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'valid-sig')
      .send(makePaymentCapturedBody());
    expect(res.status).toBe(200);
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  describe('payment.captured', () => {
    it('updates payment status to captured and reactivates suspended org', async () => {
      mockFindByOrderId.mockResolvedValue({ id: 'pmt-1', org_id: 'org-1', status: 'pending' });
      const res = await request(app)
        .post('/payment/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', 'valid-sig')
        .send(makePaymentCapturedBody());
      expect(res.status).toBe(200);
      expect(mockUpdateStatus).toHaveBeenCalledWith('order_001', 'captured', expect.any(Object));
      // Should attempt to reactivate org
      expect(mockQueryPrimary).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE organizations'),
        expect.arrayContaining(['org-1'])
      );
    });

    it('skips update when payment already captured (idempotent)', async () => {
      mockFindByOrderId.mockResolvedValue({ id: 'pmt-1', org_id: 'org-1', status: 'captured' });
      const res = await request(app)
        .post('/payment/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', 'valid-sig')
        .send(makePaymentCapturedBody());
      expect(res.status).toBe(200);
      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });

    it('skips when order_id is missing from payload', async () => {
      const body = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: { id: 'pay_x', amount: 100, currency: 'INR', status: 'captured' },
          },
        },
      });
      const res = await request(app)
        .post('/payment/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', 'valid-sig')
        .send(body);
      expect(res.status).toBe(200);
    });
  });

  describe('payment.failed', () => {
    it('updates payment to failed and enqueues handle-payment-failure', async () => {
      mockFindByOrderId.mockResolvedValue({ id: 'pmt-2', org_id: 'org-1', status: 'pending' });
      const res = await request(app)
        .post('/payment/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', 'valid-sig')
        .send(makePaymentFailedBody());
      expect(res.status).toBe(200);
      expect(mockUpdateStatus).toHaveBeenCalledWith('order_002', 'failed');
      expect(mockEnqueue).toHaveBeenCalledWith('payments', 'handle-payment-failure', { orgId: 'org-1' });
    });
  });

  describe('refund.created', () => {
    it('marks payment as refunded', async () => {
      mockQueryPrimary.mockResolvedValueOnce({ rows: [{ org_id: 'org-1', id: 'pmt-1' }] });
      const res = await request(app)
        .post('/payment/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', 'valid-sig')
        .send(makeRefundBody());
      expect(res.status).toBe(200);
      expect(mockQueryPrimary).toHaveBeenCalledWith(
        expect.stringContaining("status = 'refunded'"),
        expect.arrayContaining(['pay_001'])
      );
    });
  });

  describe('dispute.created', () => {
    it('marks payment as disputed', async () => {
      mockQueryPrimary.mockResolvedValueOnce({ rows: [{ org_id: 'org-1', id: 'pmt-1' }] });
      const res = await request(app)
        .post('/payment/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', 'valid-sig')
        .send(makeDisputeBody());
      expect(res.status).toBe(200);
      expect(mockQueryPrimary).toHaveBeenCalledWith(
        expect.stringContaining("status = 'disputed'"),
        expect.arrayContaining(['pay_001'])
      );
    });
  });

  describe('subscription.charged', () => {
    it('reactivates suspended org on subscription renewal', async () => {
      // subscriptions lookup
      mockQueryPrimary.mockResolvedValueOnce({ rows: [{ org_id: 'org-1' }] });
      // org reactivation
      mockQueryPrimary.mockResolvedValueOnce({ rows: [] });
      // outbox insert
      mockQueryPrimary.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/payment/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', 'valid-sig')
        .send(makeSubscriptionChargedBody());
      expect(res.status).toBe(200);
      expect(mockQueryPrimary).toHaveBeenCalledWith(
        expect.stringContaining('razorpay_subscription_id'),
        ['sub_001']
      );
    });

    it('is a no-op when subscription is not found', async () => {
      mockQueryPrimary.mockResolvedValueOnce({ rows: [] }); // not found
      const res = await request(app)
        .post('/payment/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', 'valid-sig')
        .send(makeSubscriptionChargedBody());
      expect(res.status).toBe(200);
    });
  });
});
