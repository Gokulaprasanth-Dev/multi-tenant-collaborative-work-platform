import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate, validateQuery } from '../../shared/validation/validate.middleware';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import { orgContextMiddleware } from '../../shared/auth-middleware/org-context.middleware';
import { orgStatusMiddleware } from '../../shared/auth-middleware/org-status.middleware';
import { NotificationRepository } from './notification.repository';
import { updatePreference, listPreferences } from './preference.service';
import { hmac } from '../../shared/crypto';
import { config } from '../../shared/config';
import { AppError } from '../../shared/errors/app-errors';
import { logger } from '../../shared/observability/logger';

const router = Router();
const orgMiddleware = [jwtMiddleware, orgContextMiddleware, orgStatusMiddleware];
const notifRepo = new NotificationRepository();

// ── GET /api/v1/orgs/:orgId/notifications ─────────────────────────────────

router.get(
  '/orgs/:orgId/notifications',
  ...orgMiddleware,
  validateQuery(z.object({
    unread_only: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const onlyUnread = req.query['unread_only'] === 'true';
      const limit = Number(req.query['limit'] ?? 50);
      const offset = Number(req.query['offset'] ?? 0);
      const notifications = await notifRepo.findByUser(
        req.orgContext!.orgId, req.user!.userId, onlyUnread, limit, offset
      );
      res.success(notifications);
    } catch (err) { next(err); }
  }
);

// ── PATCH /api/v1/orgs/:orgId/notifications/:notificationId/read ──────────

router.patch(
  '/orgs/:orgId/notifications/:notificationId/read',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const marked = await notifRepo.markRead(
        req.orgContext!.orgId,
        req.user!.userId,
        req.params['notificationId']!
      );
      if (!marked) {
        res.success({ message: 'Already read or not found' });
      } else {
        res.success({ message: 'Marked as read' });
      }
    } catch (err) { next(err); }
  }
);

// ── POST /api/v1/orgs/:orgId/notifications/read-all ──────────────────────

router.post(
  '/orgs/:orgId/notifications/read-all',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await notifRepo.markAllRead(req.orgContext!.orgId, req.user!.userId);
      res.success({ marked: count });
    } catch (err) { next(err); }
  }
);

// ── GET /api/v1/orgs/:orgId/notification-preferences ─────────────────────

router.get(
  '/orgs/:orgId/notification-preferences',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const prefs = await listPreferences(req.orgContext!.orgId, req.user!.userId);
      res.success(prefs);
    } catch (err) { next(err); }
  }
);

// ── PATCH /api/v1/orgs/:orgId/notification-preferences/:eventType ─────────

router.patch(
  '/orgs/:orgId/notification-preferences/:eventType',
  ...orgMiddleware,
  validate(z.object({
    channel_inapp: z.boolean().optional(),
    channel_email: z.boolean().optional(),
    channel_push: z.boolean().optional(),
    digest_mode: z.enum(['realtime', 'daily_digest']).optional(),
    quiet_hours_start: z.string().nullable().optional(),
    quiet_hours_end: z.string().nullable().optional(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pref = await updatePreference(
        req.orgContext!.orgId,
        req.user!.userId,
        req.params['eventType']!,
        req.body as Parameters<typeof updatePreference>[3]
      );
      res.success(pref);
    } catch (err) { next(err); }
  }
);

// ── GET /api/v1/notifications/unsubscribe  (public — email link) ──────────
// Token is HMAC(inviteSecret, userId:orgId:eventType)
// Validates token then sets channel_email = false for that event type.

router.get(
  '/notifications/unsubscribe',
  validateQuery(z.object({
    token: z.string().min(1),
    userId: z.string().uuid(),
    orgId: z.string().uuid(),
    eventType: z.string().min(1),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, userId, orgId, eventType } = req.query as {
        token: string; userId: string; orgId: string; eventType: string;
      };

      // Validate HMAC token
      const expected = hmac(`${userId}:${orgId}:${eventType}`, config.inviteSecret);
      if (token !== expected) {
        logger.warn({ userId, orgId, eventType }, 'unsubscribe: invalid HMAC token');
        throw new AppError(400, 'INVALID_UNSUBSCRIBE_TOKEN', 'Invalid or expired unsubscribe link');
      }

      await updatePreference(orgId, userId, eventType, { channel_email: false });
      res.success({ message: `Unsubscribed from ${eventType} emails` });
    } catch (err) { next(err); }
  }
);

export default router;
