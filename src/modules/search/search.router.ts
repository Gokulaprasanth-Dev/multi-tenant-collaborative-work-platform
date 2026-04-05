import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateQuery } from '../../shared/validation/validate.middleware';
import { jwtMiddleware } from '../../shared/auth-middleware/jwt.middleware';
import { orgContextMiddleware } from '../../shared/auth-middleware/org-context.middleware';
import { orgStatusMiddleware } from '../../shared/auth-middleware/org-status.middleware';
import * as SearchService from './search.service';

const router = Router();
const orgMiddleware = [jwtMiddleware, orgContextMiddleware, orgStatusMiddleware];

// ── GET /api/v1/orgs/:orgId/search ────────────────────────────────────────

router.get(
  '/orgs/:orgId/search',
  ...orgMiddleware,
  validateQuery(z.object({
    q: z.string().min(1).max(200),
    entity_types: z.string().optional(), // comma-separated: task,message,file,user
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = req.query['q'] as string;
      const entityTypesParam = req.query['entity_types'] as string | undefined;
      const entityTypes = entityTypesParam
        ? (entityTypesParam.split(',').filter(t =>
            ['task', 'message', 'file', 'user'].includes(t)
          ) as Array<'task' | 'message' | 'file' | 'user'>)
        : undefined;
      const limit = Number(req.query['limit'] ?? 20);
      const offset = Number(req.query['offset'] ?? 0);

      const result = await SearchService.search({
        query: q,
        orgId: req.orgContext!.orgId,
        entityTypes,
        limit,
        offset,
      });

      if (result.degraded) {
        res.set('meta-search-degraded', 'true');
        return res.status(200).json({
          data: result,
          meta: { search_degraded: true },
        });
      }

      res.success(result);
    } catch (err) { next(err); }
  }
);

export default router;
