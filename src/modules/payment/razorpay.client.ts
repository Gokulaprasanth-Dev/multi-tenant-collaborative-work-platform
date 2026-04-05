import Razorpay from 'razorpay';
import * as crypto from 'crypto';
import { razorpayBreaker } from '../../shared/circuit-breaker';
import { config } from '../../shared/config';
import { logger } from '../../shared/observability/logger';
import { withSpan } from '../../shared/observability/tracer';

export interface RazorpayOrder {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  receipt: string | null;
  created_at: number;
}

export interface RazorpayPayment {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  order_id: string;
  method: string;
  captured: boolean;
  created_at: number;
}

export interface RazorpayRefund {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  payment_id: string;
  status: string;
  created_at: number;
}

export class RazorpayClient {
  private client: Razorpay;

  constructor() {
    this.client = new Razorpay({
      key_id: config.razorpayKeyId,
      key_secret: config.razorpayKeySecret,
    });
  }

  async createOrder(
    amount: number,
    currency: string,
    receipt: string,
    notes?: Record<string, string>
  ): Promise<RazorpayOrder> {
    return withSpan('razorpay.createOrder', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return razorpayBreaker.fire(async () => {
        const order = await this.client.orders.create({ amount, currency, receipt, notes });
        logger.debug({ orderId: (order as unknown as RazorpayOrder).id }, 'razorpay: order created');
        return order as unknown as RazorpayOrder;
      }) as unknown as RazorpayOrder;
    }, { 'razorpay.amount': amount, 'razorpay.currency': currency });
  }

  async fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    return razorpayBreaker.fire(async () => {
      const payment = await this.client.payments.fetch(paymentId);
      return payment as unknown as RazorpayPayment;
    }) as unknown as RazorpayPayment;
  }

  async createRefund(paymentId: string, amount?: number): Promise<RazorpayRefund> {
    return razorpayBreaker.fire(async () => {
      // razorpay SDK types don't include refund directly on payments — use any cast
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const refund = await (this.client.payments as any).refund(paymentId, amount ? { amount } : {});
      logger.debug({ paymentId, refundId: refund.id }, 'razorpay: refund created');
      return refund as RazorpayRefund;
    }) as unknown as RazorpayRefund;
  }

  /**
   * Verifies a payment signature.
   * computed = HMAC-SHA256(razorpayKeySecret, orderId + '|' + paymentId)
   * SEC fix: uses timingSafeEqual to prevent timing attacks.
   */
  verifyPaymentSignature(
    orderId: string,
    paymentId: string,
    signature: string
  ): boolean {
    try {
      const payload = `${orderId}|${paymentId}`;
      const computed = crypto
        .createHmac('sha256', config.razorpayKeySecret)
        .update(payload)
        .digest('hex');
      const computedBuf = Buffer.from(computed, 'hex');
      const signatureBuf = Buffer.from(signature, 'hex');
      if (computedBuf.length !== signatureBuf.length) return false;
      return crypto.timingSafeEqual(computedBuf, signatureBuf);
    } catch {
      return false;
    }
  }

  /**
   * Verifies a Razorpay webhook signature.
   * computed = HMAC-SHA256(razorpayWebhookSecret, rawBody)
   * SEC fix: uses timingSafeEqual to prevent timing attacks.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    try {
      const computed = crypto
        .createHmac('sha256', config.razorpayWebhookSecret)
        .update(rawBody)
        .digest('hex');
      const computedBuf = Buffer.from(computed, 'hex');
      const signatureBuf = Buffer.from(signature, 'hex');
      if (computedBuf.length !== signatureBuf.length) return false;
      return crypto.timingSafeEqual(computedBuf, signatureBuf);
    } catch {
      return false;
    }
  }
}

// Singleton
export const razorpayClient = new RazorpayClient();
