import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../../shared/validation/validate.middleware';
import { validateQuery } from '../../shared/validation/validate.middleware';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import { orgContextMiddleware } from '../../shared/auth-middleware/org-context.middleware';
import { orgStatusMiddleware } from '../../shared/auth-middleware/org-status.middleware';
import * as FileService from './file.service';
import { SCAN_PENDING_SIGNAL } from './file.service';

const router = Router();
const orgMiddleware = [jwtMiddleware, orgContextMiddleware, orgStatusMiddleware];

// ── POST /api/v1/orgs/:orgId/files/upload-url ─────────────────────────────

router.post(
  '/orgs/:orgId/files/upload-url',
  ...orgMiddleware,
  validate(z.object({
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().positive(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { filename, mimeType, sizeBytes } = req.body as {
        filename: string;
        mimeType: string;
        sizeBytes: number;
      };
      const result = await FileService.requestUploadUrl(
        req.orgContext!.orgId,
        req.user!.userId,
        { filename, mimeType, sizeBytes }
      );
      res.created(result);
    } catch (err) { next(err); }
  }
);

// ── GET /api/v1/orgs/:orgId/files/:fileId/download-url ────────────────────

router.get(
  '/orgs/:orgId/files/:fileId/download-url',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await FileService.generateDownloadUrl(
        req.orgContext!.orgId,
        req.params['fileId']!,
        req.user!.userId
      );

      if (result === SCAN_PENDING_SIGNAL) {
        // CONSISTENCY-005 fix: scan pending → 202 with Retry-After: 30
        res.set('Retry-After', '30');
        return res.status(202).json({ message: 'File scan in progress, please retry later' });
      }

      res.success(result);
    } catch (err) { next(err); }
  }
);

// ── GET /api/v1/orgs/:orgId/files ─────────────────────────────────────────

router.get(
  '/orgs/:orgId/files',
  ...orgMiddleware,
  validateQuery(z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Number(req.query['limit'] ?? 20);
      const offset = Number(req.query['offset'] ?? 0);
      const files = await FileService.listFiles(req.orgContext!.orgId, limit, offset);
      res.success(files);
    } catch (err) { next(err); }
  }
);

// ── GET /api/v1/orgs/:orgId/files/:fileId ─────────────────────────────────

router.get(
  '/orgs/:orgId/files/:fileId',
  ...orgMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = await FileService.getFile(req.orgContext!.orgId, req.params['fileId']!);
      res.success(file);
    } catch (err) { next(err); }
  }
);

export default router;
