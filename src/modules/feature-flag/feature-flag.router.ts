import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../../shared/validation/validate.middleware';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import { platformAdminMiddleware } from '../platform-admin/admin.middleware';
import * as FeatureFlagService from './feature-flag.service';

const router = Router();
const adminMiddleware = [jwtMiddleware, platformAdminMiddleware];

// ── GET /admin/feature-flags ──────────────────────────────────────────────

router.get(
  '/admin/feature-flags',
  ...adminMiddleware,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const flags = await FeatureFlagService.listFlags();
      res.success(flags);
    } catch (err) { next(err); }
  }
);

// ── POST /admin/feature-flags ─────────────────────────────────────────────

router.post(
  '/admin/feature-flags',
  ...adminMiddleware,
  validate(z.object({
    key: z.string().min(1).max(100),
    is_globally_enabled: z.boolean().optional(),
    description: z.string().optional(),
    enabled_org_ids: z.array(z.string().uuid()).optional(),
    disabled_org_ids: z.array(z.string().uuid()).optional(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const flag = await FeatureFlagService.createFlag(req.body as Parameters<typeof FeatureFlagService.createFlag>[0]);
      res.created(flag);
    } catch (err) { next(err); }
  }
);

// ── PATCH /admin/feature-flags/:id ────────────────────────────────────────

router.patch(
  '/admin/feature-flags/:id',
  ...adminMiddleware,
  validate(z.object({
    is_globally_enabled: z.boolean().optional(),
    description: z.string().optional(),
    enabled_org_ids: z.array(z.string().uuid()).optional(),
    disabled_org_ids: z.array(z.string().uuid()).optional(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const flag = await FeatureFlagService.updateFlag(req.params['id']!, req.body as Parameters<typeof FeatureFlagService.updateFlag>[1]);
      if (!flag) {
        return res.status(404).json({ error: 'Feature flag not found' });
      }
      res.success(flag);
    } catch (err) { next(err); }
  }
);

// ── DELETE /admin/feature-flags/:id ──────────────────────────────────────

router.delete(
  '/admin/feature-flags/:id',
  ...adminMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await FeatureFlagService.deleteFlag(req.params['id']!);
      res.success({ deleted: true });
    } catch (err) { next(err); }
  }
);

export default router;
