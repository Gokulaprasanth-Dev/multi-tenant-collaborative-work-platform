import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../../shared/validation/validate.middleware';
import { validateQuery } from '../../shared/validation/validate.middleware';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import { platformAdminMiddleware } from './admin.middleware';
import * as AdminService from './admin.service';

const router = Router();
const adminMiddleware = [jwtMiddleware, platformAdminMiddleware];

// ── GET /admin/organizations ───────────────────────────────────────────────

router.get(
  '/admin/organizations',
  ...adminMiddleware,
  validateQuery(z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Number(req.query['limit'] ?? 50);
      const offset = Number(req.query['offset'] ?? 0);
      const orgs = await AdminService.listOrganizations(limit, offset);
      res.success(orgs);
    } catch (err) { next(err); }
  }
);

// ── POST /admin/organizations/:orgId/suspend ───────────────────────────────

router.post(
  '/admin/organizations/:orgId/suspend',
  ...adminMiddleware,
  validate(z.object({
    reason: z.string().min(1),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reason } = req.body as { reason: string };
      await AdminService.suspendOrg(req.params['orgId']!, reason, req.user!.userId);
      res.success({ suspended: true });
    } catch (err) { next(err); }
  }
);

// ── POST /admin/organizations/:orgId/reactivate ────────────────────────────

router.post(
  '/admin/organizations/:orgId/reactivate',
  ...adminMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await AdminService.reactivateOrg(req.params['orgId']!, req.user!.userId);
      res.success({ reactivated: true });
    } catch (err) { next(err); }
  }
);

// ── POST /admin/organizations/:orgId/offboard ──────────────────────────────

router.post(
  '/admin/organizations/:orgId/offboard',
  ...adminMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await AdminService.offboardOrg(req.params['orgId']!, req.user!.userId);
      res.success({ offboarding: true });
    } catch (err) { next(err); }
  }
);

// ── POST /admin/users/:userId/unlock ──────────────────────────────────────

router.post(
  '/admin/users/:userId/unlock',
  ...adminMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await AdminService.unlockUser(req.params['userId']!, req.user!.userId);
      res.success({ unlocked: true });
    } catch (err) { next(err); }
  }
);

// ── POST /admin/users/:userId/reset-mfa ───────────────────────────────────

router.post(
  '/admin/users/:userId/reset-mfa',
  ...adminMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await AdminService.resetUserMfa(req.params['userId']!, req.user!.userId);
      res.success({ mfaReset: true });
    } catch (err) { next(err); }
  }
);

// ── POST /admin/organizations/:orgId/trigger-payment-recovery ─────────────

router.post(
  '/admin/organizations/:orgId/trigger-payment-recovery',
  ...adminMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await AdminService.triggerPaymentRecovery(req.params['orgId']!, req.user!.userId);
      res.accepted({ queued: true });
    } catch (err) { next(err); }
  }
);

// ── POST /admin/outbox/:eventId/replay ────────────────────────────────────

router.post(
  '/admin/outbox/:eventId/replay',
  ...adminMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await AdminService.replayOutboxEvent(req.params['eventId']!, req.user!.userId);
      res.success({ replayed: true });
    } catch (err) { next(err); }
  }
);

// ── POST /admin/queues/:queueName/requeue-dlq ─────────────────────────────

router.post(
  '/admin/queues/:queueName/requeue-dlq',
  ...adminMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await AdminService.requeueDlqJobs(req.params['queueName']!, req.user!.userId);
      res.success({ requeued: count });
    } catch (err) { next(err); }
  }
);

// ── POST /admin/organizations/:orgId/reindex-search ───────────────────────

router.post(
  '/admin/organizations/:orgId/reindex-search',
  ...adminMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await AdminService.triggerSearchReindex(req.params['orgId']!, req.user!.userId);
      res.accepted({ queued: true });
    } catch (err) { next(err); }
  }
);

// ── POST /admin/jwt/rotate-keys ───────────────────────────────────────────

router.post(
  '/admin/jwt/rotate-keys',
  ...adminMiddleware,
  validate(z.object({
    publicKey: z.string().min(1),
    kid: z.string().min(1),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { publicKey, kid } = req.body as { publicKey: string; kid: string };
      await AdminService.rotateJwtKeys(publicKey, kid, req.user!.userId);
      res.success({ rotated: true, kid });
    } catch (err) { next(err); }
  }
);

export default router;
