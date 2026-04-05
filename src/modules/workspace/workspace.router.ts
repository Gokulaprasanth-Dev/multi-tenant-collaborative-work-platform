import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../../shared/validation/validate.middleware';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import { orgContextMiddleware } from '../../shared/auth-middleware/org-context.middleware';
import { orgStatusMiddleware } from '../../shared/auth-middleware/org-status.middleware';
import { idempotencyMiddleware } from '../../shared/idempotency/idempotency.middleware';
import * as WorkspaceService from './workspace.service';

const router = Router();
const orgMiddleware = [jwtMiddleware, orgContextMiddleware, orgStatusMiddleware];

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).nullable().optional(),
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
  version: z.number().int().positive(),
});

// ── POST /orgs/:orgId/workspaces ───────────────────────────────────────────────

router.post(
  '/orgs/:orgId/workspaces',
  ...orgMiddleware,
  idempotencyMiddleware,
  validate(createWorkspaceSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = req.orgContext!;
      const userId = req.user!.userId;
      const workspace = await WorkspaceService.createWorkspace(userId, {
        org_id: orgId,
        owner_user_id: userId,
        name: req.body.name as string,
        description: req.body.description as string | null | undefined,
      });
      res.created(workspace);
    } catch (err) { next(err); }
  }
);

// ── GET /orgs/:orgId/workspaces ────────────────────────────────────────────────

router.get(
  '/orgs/:orgId/workspaces',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = req.orgContext!;
      const workspaces = await WorkspaceService.listWorkspaces(orgId);
      res.success(workspaces);
    } catch (err) { next(err); }
  }
);

// ── GET /orgs/:orgId/workspaces/:workspaceId ───────────────────────────────────

router.get(
  '/orgs/:orgId/workspaces/:workspaceId',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = req.orgContext!;
      const workspace = await WorkspaceService.getWorkspace(orgId, req.params['workspaceId']!);
      res.success(workspace);
    } catch (err) { next(err); }
  }
);

// ── PATCH /orgs/:orgId/workspaces/:workspaceId ────────────────────────────────

router.patch(
  '/orgs/:orgId/workspaces/:workspaceId',
  ...orgMiddleware,
  validate(updateWorkspaceSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = req.orgContext!;
      const userId = req.user!.userId;
      const { version, ...data } = req.body as { version: number; name?: string; description?: string | null; status?: 'active' | 'archived' };
      const workspace = await WorkspaceService.updateWorkspace(
        orgId, req.params['workspaceId']!, data, version, userId
      );
      res.success(workspace);
    } catch (err) { next(err); }
  }
);

// ── DELETE /orgs/:orgId/workspaces/:workspaceId ───────────────────────────────

router.delete(
  '/orgs/:orgId/workspaces/:workspaceId',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = req.orgContext!;
      const userId = req.user!.userId;
      await WorkspaceService.deleteWorkspace(orgId, req.params['workspaceId']!, userId);
      res.success({ deleted: true });
    } catch (err) { next(err); }
  }
);

export default router;
