import { PaymentRepository, SubscriptionRepository, PaymentRow } from './payment.repository';
import { razorpayClient, RazorpayOrder } from './razorpay.client';
import { queryPrimary } from '../../shared/database/pool';
import { AppError, ConflictError, NotFoundError } from '../../shared/errors/app-errors';
import { logger } from '../../shared/observability/logger';

const paymentRepo = new PaymentRepository();
const subscriptionRepo = new SubscriptionRepository();

// Plan amounts in paise (INR)
const PLAN_AMOUNTS: Record<string, Record<string, number>> = {
  pro:        { monthly: 99900,  annual: 999900 },
  business:   { monthly: 299900, annual: 2999900 },
  enterprise: { monthly: 999900, annual: 9999900 },
};

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

export interface CreateOrderResult {
  order: RazorpayOrder;
  payment: PaymentRow;
}

/**
 * Creates a Razorpay order for a plan upgrade.
 * Idempotency key: {orgId}:{planTier}:{billingCycle}:{epochDay}
 */
export async function createOrder(
  orgId: string,
  planTier: string,
  billingCycle: 'monthly' | 'annual',
  userId: string
): Promise<CreateOrderResult> {
  const amounts = PLAN_AMOUNTS[planTier];
  if (!amounts) {
    throw new AppError(422, 'INVALID_PLAN', `Unknown plan tier: ${planTier}`);
  }
  const amountPaise = amounts[billingCycle];
  if (!amountPaise) {
    throw new AppError(422, 'INVALID_BILLING_CYCLE', `Unknown billing cycle: ${billingCycle}`);
  }

  const epochDay = Math.floor(Date.now() / 86_400_000);
  const idempotencyKey = `${orgId}:${planTier}:${billingCycle}:${epochDay}`;

  // Check idempotency — return existing if already created today
  const existing = await paymentRepo.findByIdempotencyKey(idempotencyKey);
  if (existing) {
    logger.debug({ idempotencyKey }, 'createOrder: returning existing payment');
    const existingOrder: RazorpayOrder = {
      id: existing.razorpay_order_id,
      entity: 'order',
      amount: existing.amount_paise,
      currency: existing.currency,
      status: existing.status,
      receipt: null,
      created_at: Math.floor(existing.created_at.getTime() / 1000),
    };
    return { order: existingOrder, payment: existing };
  }

  const receipt = `${orgId.slice(0, 8)}-${billingCycle}-${epochDay}`;
  const order = await razorpayClient.createOrder(amountPaise, 'INR', receipt, {
    orgId,
    planTier,
    billingCycle,
    userId,
  });

  const payment = await paymentRepo.create({
    org_id: orgId,
    razorpay_order_id: order.id,
    amount_paise: amountPaise,
    status: 'created',
    idempotency_key: idempotencyKey,
    metadata: { planTier, billingCycle, userId },
  });

  await writeOutboxEvent('payment.created', orgId, payment.id, {
    paymentId: payment.id, orderId: order.id, amountPaise, planTier,
  });

  return { order, payment };
}

/**
 * Verifies a Razorpay payment after client-side completion.
 * Timing-safe signature check + idempotency guard.
 */
export async function verifyPayment(
  orgId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string
): Promise<PaymentRow> {
  // Timing-safe signature check
  const valid = razorpayClient.verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, signature);
  if (!valid) {
    throw new AppError(400, 'INVALID_PAYMENT_SIGNATURE', 'Payment signature verification failed');
  }

  const payment = await paymentRepo.findByOrderId(razorpayOrderId);
  if (!payment || payment.org_id !== orgId) throw new NotFoundError('Payment');

  // Idempotency — already captured
  if (payment.status === 'captured') {
    logger.debug({ razorpayOrderId }, 'verifyPayment: already captured, returning existing');
    return payment;
  }

  const updated = await paymentRepo.updateStatus(razorpayOrderId, 'captured', {
    razorpay_payment_id: razorpayPaymentId,
    captured_at: new Date(),
  });

  if (!updated) throw new ConflictError('PAYMENT_UPDATE_CONFLICT', 'Payment status update conflict');

  // Upgrade org subscription
  const planTier = (payment.metadata['planTier'] as string) ?? 'pro';
  await subscriptionRepo.upsert(orgId, { plan_tier: planTier as 'pro' | 'business' | 'enterprise' });

  // Update org plan_tier
  await queryPrimary(
    `UPDATE organizations SET plan_tier = $1 WHERE id = $2`,
    [planTier, orgId]
  );

  await writeOutboxEvent('payment.captured', orgId, updated.id, {
    paymentId: updated.id, razorpayPaymentId, planTier,
  });

  return updated;
}
