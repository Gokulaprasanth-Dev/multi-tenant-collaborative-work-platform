// src/modules/notification/push.router.ts
import { Router } from 'express';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import { orgContextMiddleware } from '../../shared/auth-middleware/org-context.middleware';
import { idempotencyMiddleware } from '../../shared/idempotency/idempotency.middleware';
import { saveSubscription, removeSubscription, PushSubscriptionData } from './push.service';

export const pushRouter = Router();

pushRouter.post(
  '/push/subscribe',
  jwtMiddleware,
  orgContextMiddleware,
  idempotencyMiddleware,
  async (req, res, next) => {
    try {
      const { endpoint, keys } = req.body as PushSubscriptionData;
      await saveSubscription(req.user!.userId, req.user!.orgId, { endpoint, keys });
      res.created({ subscribed: true });
    } catch (err) { next(err); }
  },
);

pushRouter.delete(
  '/push/subscribe',
  jwtMiddleware,
  orgContextMiddleware,
  async (req, res, next) => {
    try {
      const { endpoint } = req.body as { endpoint: string };
      await removeSubscription(req.user!.userId, endpoint);
      res.success({ unsubscribed: true });
    } catch (err) { next(err); }
  },
);
