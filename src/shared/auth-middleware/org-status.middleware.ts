import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../errors/app-errors';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Paths that bypass the status guard for suspended orgs (auth + read-only access)
const SUSPENDED_BYPASS_PREFIXES = [
  '/api/v1/auth',
];

function isSuspendedBypass(req: Request): boolean {
  const path = req.path;
  if (!WRITE_METHODS.has(req.method)) return true; // Allow all GETs for suspended orgs
  return SUSPENDED_BYPASS_PREFIXES.some(prefix => path.startsWith(prefix));
}

export function orgStatusMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const orgStatus = req.orgContext?.orgStatus;

  if (!orgStatus) {
    return next();
  }

  switch (orgStatus) {
    case 'deleted':
      return next(new ForbiddenError('ORG_DELETED', 'Organization has been deleted'));

    case 'offboarding':
      if (WRITE_METHODS.has(req.method)) {
        return next(new ForbiddenError('ORG_OFFBOARDING', 'Organization is in offboarding — writes are disabled'));
      }
      break;

    case 'suspended':
      if (!isSuspendedBypass(req)) {
        return next(new ForbiddenError('ORG_SUSPENDED', 'Organization is suspended — writes are disabled'));
      }
      break;

    default:
      // active — allow all
      break;
  }

  next();
}
