import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../../shared/validation/validate.middleware';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import { orgContextMiddleware } from '../../shared/auth-middleware/org-context.middleware';
import { orgStatusMiddleware } from '../../shared/auth-middleware/org-status.middleware';
import { requireRole } from '../../shared/auth-middleware/require-role.middleware';
import * as WebhookService from './webhook.service';

const router = Router();
const orgMiddleware = [jwtMiddleware, orgContextMiddleware, orgStatusMiddleware];
const adminMiddleware = [...orgMiddleware, requireRole(['org_owner', 'org_admin'])];

const SUPPORTED_EVENTS = [
  'task.created', 'task.updated', 'task.deleted',
  'message.created', 'file.confirmed',
  'payment.captured', 'payment.failed',
  'member.invited', 'member.removed',
] as const;

// ── POST /api/v1/orgs/:orgId/webhooks ─────────────────────────────────────

router.post(
  '/orgs/:orgId/webhooks',
  ...adminMiddleware,
  validate(z.object({
    url: z.string().url(),
    events: z.array(z.enum(SUPPORTED_EVENTS)).min(1),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { url, events } = req.body as { url: string; events: string[] };
      const result = await WebhookService.create(
        req.orgContext!.orgId,
        req.user!.userId,
        { url, events }
      );
      res.created(result);
    } catch (err) { next(err); }
  }
);

// ── GET /api/v1/orgs/:orgId/webhooks ──────────────────────────────────────

router.get(
  '/orgs/:orgId/webhooks',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const webhooks = await WebhookService.listByOrg(req.orgContext!.orgId);
      res.success(webhooks);
    } catch (err) { next(err); }
  }
);

// ── DELETE /api/v1/orgs/:orgId/webhooks/:webhookId ────────────────────────

router.delete(
  '/orgs/:orgId/webhooks/:webhookId',
  ...adminMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await WebhookService.remove(req.orgContext!.orgId, req.params['webhookId']!);
      res.success({ deleted: true });
    } catch (err) { next(err); }
  }
);

// ── POST /api/v1/orgs/:orgId/webhooks/:webhookId/rotate-secret ────────────

router.post(
  '/orgs/:orgId/webhooks/:webhookId/rotate-secret',
  ...adminMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await WebhookService.rotateSecret(
        req.orgContext!.orgId,
        req.params['webhookId']!,
        req.user!.userId
      );
      res.success(result);
    } catch (err) { next(err); }
  }
);

export default router;
