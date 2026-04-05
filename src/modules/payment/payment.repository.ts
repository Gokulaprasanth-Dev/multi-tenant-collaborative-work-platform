import { queryPrimary, queryReplica } from '../../shared/database/pool';

export interface PaymentRow {
  id: string;
  org_id: string;
  subscription_id: string | null;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  amount_paise: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'disputed';
  failure_reason: string | null;
  captured_at: Date | null;
  refunded_at: Date | null;
  idempotency_key: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface SubscriptionRow {
  id: string;
  org_id: string;
  razorpay_subscription_id: string | null;
  plan_tier: 'free' | 'pro' | 'business' | 'enterprise';
  status: 'active' | 'halted' | 'cancelled' | 'expired' | 'pending';
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  cancelled_at: Date | null;
  trial_end: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface CreatePaymentData {
  org_id: string;
  subscription_id?: string | null;
  razorpay_order_id: string;
  amount_paise: number;
  currency?: string;
  status: PaymentRow['status'];
  idempotency_key: string;
  metadata?: Record<string, unknown>;
}

// ── PaymentRepository ───────────────────────────────────────────────────────

export class PaymentRepository {
  async create(data: CreatePaymentData): Promise<PaymentRow> {
    const result = await queryPrimary(
      `INSERT INTO payments
         (org_id, subscription_id, razorpay_order_id, amount_paise, currency, status, idempotency_key, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING *`,
      [
        data.org_id,
        data.subscription_id ?? null,
        data.razorpay_order_id,
        data.amount_paise,
        data.currency ?? 'INR',
        data.status,
        data.idempotency_key,
        JSON.stringify(data.metadata ?? {}),
      ]
    );
    return result.rows[0] as unknown as PaymentRow;
  }

  async findByOrderId(razorpayOrderId: string): Promise<PaymentRow | null> {
    const result = await queryPrimary(
      `SELECT * FROM payments WHERE razorpay_order_id = $1 LIMIT 1`,
      [razorpayOrderId]
    );
    return (result.rows[0] as unknown as PaymentRow) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<PaymentRow | null> {
    const result = await queryPrimary(
      `SELECT * FROM payments WHERE idempotency_key = $1 LIMIT 1`,
      [key]
    );
    return (result.rows[0] as unknown as PaymentRow) ?? null;
  }

  async findByOrg(orgId: string, limit = 20, offset = 0): Promise<PaymentRow[]> {
    const result = await queryReplica(
      `SELECT * FROM payments WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [orgId, limit, offset]
    );
    return result.rows as unknown as PaymentRow[];
  }

  async updateStatus(
    razorpayOrderId: string,
    status: PaymentRow['status'],
    extra: {
      razorpay_payment_id?: string;
      failure_reason?: string;
      captured_at?: Date;
      refunded_at?: Date;
    } = {}
  ): Promise<PaymentRow | null> {
    const setClauses: string[] = ['status = $1'];
    const params: unknown[] = [status];
    let idx = 2;

    if (extra.razorpay_payment_id !== undefined) { setClauses.push(`razorpay_payment_id = $${idx++}`); params.push(extra.razorpay_payment_id); }
    if (extra.failure_reason !== undefined) { setClauses.push(`failure_reason = $${idx++}`); params.push(extra.failure_reason); }
    if (extra.captured_at !== undefined) { setClauses.push(`captured_at = $${idx++}`); params.push(extra.captured_at); }
    if (extra.refunded_at !== undefined) { setClauses.push(`refunded_at = $${idx++}`); params.push(extra.refunded_at); }

    params.push(razorpayOrderId);
    const result = await queryPrimary(
      `UPDATE payments SET ${setClauses.join(', ')} WHERE razorpay_order_id = $${idx} RETURNING *`,
      params
    );
    return (result.rows[0] as unknown as PaymentRow) ?? null;
  }
}

// ── SubscriptionRepository ──────────────────────────────────────────────────

export class SubscriptionRepository {
  async findByOrg(orgId: string): Promise<SubscriptionRow | null> {
    const result = await queryReplica(
      `SELECT * FROM subscriptions WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );
    return (result.rows[0] as unknown as SubscriptionRow) ?? null;
  }

  async upsert(
    orgId: string,
    data: {
      razorpay_subscription_id?: string | null;
      plan_tier: SubscriptionRow['plan_tier'];
      status?: SubscriptionRow['status'];
      current_period_start?: Date | null;
      current_period_end?: Date | null;
    }
  ): Promise<SubscriptionRow> {
    const result = await queryPrimary(
      `INSERT INTO subscriptions (org_id, razorpay_subscription_id, plan_tier, status, current_period_start, current_period_end)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (org_id)
       DO UPDATE SET
         razorpay_subscription_id = COALESCE(EXCLUDED.razorpay_subscription_id, subscriptions.razorpay_subscription_id),
         plan_tier = EXCLUDED.plan_tier,
         status = COALESCE(EXCLUDED.status, subscriptions.status),
         current_period_start = COALESCE(EXCLUDED.current_period_start, subscriptions.current_period_start),
         current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end)
       RETURNING *`,
      [
        orgId,
        data.razorpay_subscription_id ?? null,
        data.plan_tier,
        data.status ?? 'active',
        data.current_period_start ?? null,
        data.current_period_end ?? null,
      ]
    );
    return result.rows[0] as unknown as SubscriptionRow;
  }

  async updateStatus(
    orgId: string,
    status: SubscriptionRow['status'],
    extra: {
      cancelled_at?: Date | null;
      cancel_at_period_end?: boolean;
    } = {}
  ): Promise<SubscriptionRow | null> {
    const setClauses: string[] = ['status = $1'];
    const params: unknown[] = [status];
    let idx = 2;

    if (extra.cancelled_at !== undefined) { setClauses.push(`cancelled_at = $${idx++}`); params.push(extra.cancelled_at); }
    if (extra.cancel_at_period_end !== undefined) { setClauses.push(`cancel_at_period_end = $${idx++}`); params.push(extra.cancel_at_period_end); }

    params.push(orgId);
    const result = await queryPrimary(
      `UPDATE subscriptions SET ${setClauses.join(', ')} WHERE org_id = $${idx} RETURNING *`,
      params
    );
    return (result.rows[0] as unknown as SubscriptionRow) ?? null;
  }
}
