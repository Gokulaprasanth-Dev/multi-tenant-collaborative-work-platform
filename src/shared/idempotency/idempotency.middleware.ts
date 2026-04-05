import { Request, Response, NextFunction } from 'express';
import { IdempotencyService } from './idempotency.service';
import { BadRequestError } from '../errors/app-errors';

// DELETE is explicitly excluded — HTTP DELETE is idempotent by definition
const IDEMPOTENCY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!IDEMPOTENCY_METHODS.has(req.method)) {
    return next();
  }

  const clientKey = req.headers['idempotency-key'] as string | undefined;
  if (!clientKey) {
    return next(new BadRequestError('MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required for mutating requests'));
  }

  const userId = req.user?.userId;
  // For pre-org endpoints (e.g. POST /orgs), there is no orgId — fall back to userId as scope.
  // Use || (not ??) so that empty string orgId (JWT issued without org context) is treated as absent.
  const orgId = req.orgContext?.orgId || req.user?.orgId || userId;

  if (!userId || !orgId) {
    // Auth middleware should have run first — pass through if not authenticated
    return next();
  }

  try {
    const result = await IdempotencyService.checkAndStore(clientKey, orgId, userId, req.path);

    if (result.cached) {
      res.status(result.response.status).json(result.response.body);
      return;
    }

    // Intercept res.json to persist the response before it is flushed
    const keyHash = result.keyHash;
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      const capturedStatus = res.statusCode;
      // Await the save so that any immediately-following duplicate request
      // finds the completed cache entry rather than the in-progress sentinel.
      IdempotencyService.saveResponse(keyHash, capturedStatus, body as Record<string, unknown>)
        .catch(() => { /* Non-fatal */ })
        .finally(() => originalJson(body));
      return res;
    };

    next();
  } catch (err) {
    next(err);
  }
}
