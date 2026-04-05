import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../../shared/validation/validate.middleware';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import { orgContextMiddleware } from '../../shared/auth-middleware/org-context.middleware';
import { orgStatusMiddleware } from '../../shared/auth-middleware/org-status.middleware';
import { idempotencyMiddleware } from '../../shared/idempotency/idempotency.middleware';
import { ForbiddenError } from '../../shared/errors/app-errors';
import { PaymentRepository, SubscriptionRepository } from './payment.repository';
import * as PaymentService from './payment.service';
import webhookRouter from './webhook.handler';

const router = Router();
const orgMiddleware = [jwtMiddleware, orgContextMiddleware, orgStatusMiddleware];
const paymentRepo = new PaymentRepository();
const subscriptionRepo = new SubscriptionRepository();

// ── POST /api/v1/orgs/:orgId/payments/orders ──────────────────────────────

router.post(
  '/orgs/:orgId/payments/orders',
  ...orgMiddleware,
  idempotencyMiddleware,
  validate(z.object({
    plan_tier: z.enum(['pro', 'business', 'enterprise']),
    billing_cycle: z.enum(['monthly', 'annual']),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const role = req.orgContext!.memberRole;
      if (role !== 'org_owner' && role !== 'org_admin') {
        throw new ForbiddenError('INSUFFICIENT_ROLE', 'Only org owners and admins can manage payments');
      }
      const { plan_tier, billing_cycle } = req.body as { plan_tier: string; billing_cycle: 'monthly' | 'annual' };
      const result = await PaymentService.createOrder(
        req.orgContext!.orgId,
        plan_tier,
        billing_cycle,
        req.user!.userId
      );
      res.created(result);
    } catch (err) { next(err); }
  }
);

// ── POST /api/v1/orgs/:orgId/payments/verify ──────────────────────────────

router.post(
  '/orgs/:orgId/payments/verify',
  ...orgMiddleware,
  validate(z.object({
    razorpay_order_id: z.string().min(1),
    razorpay_payment_id: z.string().min(1),
    razorpay_signature: z.string().min(1),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body as {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      };
      const payment = await PaymentService.verifyPayment(
        req.orgContext!.orgId,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      );
      res.success(payment);
    } catch (err) { next(err); }
  }
);

// ── GET /api/v1/orgs/:orgId/payments ─────────────────────────────────────

router.get(
  '/orgs/:orgId/payments',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const role = req.orgContext!.memberRole;
      if (role !== 'org_owner' && role !== 'org_admin') {
        throw new ForbiddenError('INSUFFICIENT_ROLE', 'Only org owners and admins can view payment history');
      }
      const limit = Number(req.query['limit'] ?? 20);
      const offset = Number(req.query['offset'] ?? 0);
      const payments = await paymentRepo.findByOrg(req.orgContext!.orgId, limit, offset);
      res.success(payments);
    } catch (err) { next(err); }
  }
);

// ── GET /api/v1/orgs/:orgId/subscription ─────────────────────────────────

router.get(
  '/orgs/:orgId/subscription',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sub = await subscriptionRepo.findByOrg(req.orgContext!.orgId);
      res.success(sub);
    } catch (err) { next(err); }
  }
);

// ── Webhook routes (mounted separately — uses express.raw()) ─────────────

router.use('/webhooks', webhookRouter);

export default router;
