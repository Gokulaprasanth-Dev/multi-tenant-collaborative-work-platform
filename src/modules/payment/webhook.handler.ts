import { Router, Request, Response } from 'express';
import express from 'express';
import { z } from 'zod';
import { razorpayClient } from './razorpay.client';
import { PaymentRepository, SubscriptionRepository } from './payment.repository';
import { enqueue } from '../../shared/queue/queues';
import { queryPrimary } from '../../shared/database/pool';
import { redisClient } from '../../shared/redis/clients';
import { logger } from '../../shared/observability/logger';

const router = Router();
const paymentRepo = new PaymentRepository();
const subscriptionRepo = new SubscriptionRepository();

// ── Zod schema for Razorpay webhook payload (C-04 fix) ──────────────────────

const RazorpayPaymentEntity = z.object({
  id: z.string(),
  order_id: z.string().optional(),
  amount: z.number(),
  currency: z.string(),
  status: z.string(),
  notes: z.record(z.unknown()).optional(),
});

const RazorpaySubscriptionEntity = z.object({
  id: z.string(),
  plan_id: z.string().optional(),
  status: z.string(),
});

const RazorpayRefundEntity = z.object({
  id: z.string(),
  payment_id: z.string(),
  amount: z.number(),
});

const RazorpayDisputeEntity = z.object({
  id: z.string(),
  payment_id: z.string(),
  amount: z.number(),
  reason_code: z.string().optional(),
});

const RazorpayWebhookPayloadSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('payment.captured'),
    payload: z.object({ payment: z.object({ entity: RazorpayPaymentEntity }) }),
  }),
  z.object({
    event: z.literal('payment.failed'),
    payload: z.object({ payment: z.object({ entity: RazorpayPaymentEntity }) }),
  }),
  z.object({
    event: z.literal('subscription.charged'),
    payload: z.object({ subscription: z.object({ entity: RazorpaySubscriptionEntity }) }),
  }),
  z.object({
    event: z.literal('refund.created'),
    payload: z.object({ refund: z.object({ entity: RazorpayRefundEntity }) }),
  }),
  z.object({
    event: z.literal('dispute.created'),
    payload: z.object({ dispute: z.object({ entity: RazorpayDisputeEntity }) }),
  }),
]);

type RazorpayWebhookPayload = z.infer<typeof RazorpayWebhookPayloadSchema>;

const IDEMPOTENCY_TTL = 7 * 24 * 3600; // 7 days

async function writeOutboxEvent(
  eventType: string,
  orgId: string,
  entityId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await queryPrimary(
    `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
     VALUES ($1, $2, 'payment', $3, NULL, $4::jsonb, NOW())`,
    [orgId, eventType, entityId, JSON.stringify(payload)]
  );
}

async function handlePaymentCaptured(data: Extract<RazorpayWebhookPayload, { event: 'payment.captured' }>): Promise<void> {
  const entity = data.payload.payment.entity;
  if (!entity.order_id) return;

  const payment = await paymentRepo.findByOrderId(entity.order_id);
  if (!payment) { logger.warn({ orderId: entity.order_id }, 'webhook: payment not found'); return; }
  if (payment.status === 'captured') return; // idempotent

  await paymentRepo.updateStatus(entity.order_id, 'captured', {
    razorpay_payment_id: entity.id,
    captured_at: new Date(),
  });

  const orgId = payment.org_id;

  // If org was suspended, reactivate and clear grace period
  await queryPrimary(
    `UPDATE organizations SET status = 'active', grace_period_ends_at = NULL WHERE id = $1 AND status = 'suspended'`,
    [orgId]
  );

  await writeOutboxEvent('payment.captured', orgId, payment.id, { paymentId: payment.id });
}

async function handlePaymentFailed(data: Extract<RazorpayWebhookPayload, { event: 'payment.failed' }>): Promise<void> {
  const entity = data.payload.payment.entity;
  if (!entity.order_id) return;

  const payment = await paymentRepo.findByOrderId(entity.order_id);
  if (!payment) return;

  await paymentRepo.updateStatus(entity.order_id, 'failed');

  const orgId = payment.org_id;
  await enqueue('payments', 'handle-payment-failure', { orgId });
}

async function handleSubscriptionCharged(data: Extract<RazorpayWebhookPayload, { event: 'subscription.charged' }>): Promise<void> {
  const entity = data.payload.subscription.entity;
  const _sub = await subscriptionRepo.findByOrg(''); // will be looked up by razorpay_subscription_id
  // Find by razorpay_subscription_id
  const result = await queryPrimary(
    `SELECT org_id FROM subscriptions WHERE razorpay_subscription_id = $1 LIMIT 1`,
    [entity.id]
  );
  if (result.rows.length === 0) return;
  const orgId = (result.rows[0] as { org_id: string }).org_id;

  // Reactivate if suspended
  await queryPrimary(
    `UPDATE organizations SET status = 'active', grace_period_ends_at = NULL WHERE id = $1 AND status = 'suspended'`,
    [orgId]
  );

  await writeOutboxEvent('payment.subscription_charged', orgId, entity.id, { subscriptionId: entity.id });
}

async function handleRefundCreated(data: Extract<RazorpayWebhookPayload, { event: 'refund.created' }>): Promise<void> {
  const entity = data.payload.refund.entity;
  const result = await queryPrimary(
    `UPDATE payments SET status = 'refunded', refunded_at = NOW() WHERE razorpay_payment_id = $1 RETURNING org_id, id`,
    [entity.payment_id]
  );
  if (result.rows.length === 0) return;
  const { org_id: orgId, id: paymentId } = result.rows[0] as { org_id: string; id: string };
  await writeOutboxEvent('payment.refunded', orgId, paymentId, { refundId: entity.id });
}

async function handleDisputeCreated(data: Extract<RazorpayWebhookPayload, { event: 'dispute.created' }>): Promise<void> {
  const entity = data.payload.dispute.entity;
  const result = await queryPrimary(
    `UPDATE payments SET status = 'disputed' WHERE razorpay_payment_id = $1 RETURNING org_id, id`,
    [entity.payment_id]
  );
  if (result.rows.length === 0) return;
  const { org_id: orgId, id: paymentId } = result.rows[0] as { org_id: string; id: string };
  await writeOutboxEvent('payment.disputed', orgId, paymentId, { disputeId: entity.id });
}

// ── Webhook route — express.raw() MUST come before express.json() ─────────

router.post(
  '/razorpay',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const signature = req.headers['x-razorpay-signature'] as string | undefined;

    if (!signature) {
      logger.warn('webhook: missing x-razorpay-signature header');
      return res.status(400).json({ error: 'Missing signature' });
    }

    if (!razorpayClient.verifyWebhookSignature(req.body as Buffer, signature)) {
      logger.warn('webhook: invalid Razorpay webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse((req.body as Buffer).toString());
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    // Validate against Zod schema (C-04 fix) — unknown event types return 200
    const parsed = RazorpayWebhookPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      logger.warn({ shape: rawPayload }, 'webhook: unrecognized payload shape — returning 200');
      return res.status(200).json({ received: true });
    }

    const webhookData = parsed.data;

    // Idempotency check — use event type + entity id as dedup key
    const eventEntityId = (() => {
      switch (webhookData.event) {
        case 'payment.captured':
        case 'payment.failed':
          return webhookData.payload.payment.entity.id;
        case 'subscription.charged':
          return webhookData.payload.subscription.entity.id;
        case 'refund.created':
          return webhookData.payload.refund.entity.id;
        case 'dispute.created':
          return webhookData.payload.dispute.entity.id;
      }
    })();

    const idempotencyKey = `webhook:razorpay:${webhookData.event}:${eventEntityId}`;
    const alreadyProcessed = await redisClient.get(idempotencyKey);
    if (alreadyProcessed) {
      logger.debug({ idempotencyKey }, 'webhook: duplicate event, skipping');
      return res.status(200).json({ received: true });
    }

    try {
      switch (webhookData.event) {
        case 'payment.captured':
          await handlePaymentCaptured(webhookData);
          break;
        case 'payment.failed':
          await handlePaymentFailed(webhookData);
          break;
        case 'subscription.charged':
          await handleSubscriptionCharged(webhookData);
          break;
        case 'refund.created':
          await handleRefundCreated(webhookData);
          break;
        case 'dispute.created':
          await handleDisputeCreated(webhookData);
          break;
      }

      await redisClient.set(idempotencyKey, '1', 'EX', IDEMPOTENCY_TTL);
    } catch (err) {
      logger.error({ err, event: webhookData.event }, 'webhook: handler error');
      return res.status(500).json({ error: 'Internal error' });
    }

    return res.status(200).json({ received: true });
  }
);

export default router;
