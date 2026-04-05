import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../redis/clients';
import { queryReplica } from '../database/pool';
import { UnauthorizedError, ForbiddenError } from '../errors/app-errors';

interface OrgSessionCache {
  orgId: string;
  orgStatus: string;
  memberRole: string;
}

const SESSION_CACHE_TTL = 30; // seconds

async function resolveOrgContext(userId: string, orgId: string): Promise<OrgSessionCache> {
  const cacheKey = `session:${userId}:${orgId}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached) as OrgSessionCache;
  } catch {
    // Redis failure — fall through to DB
  }

  // Query membership and org in one round trip
  const result = await queryReplica<{
    role: string;
    org_status: string;
  }>(
    `SELECT om.role, o.status AS org_status
     FROM org_memberships om
     JOIN organizations o ON o.id = om.org_id
     WHERE om.org_id = $1
       AND om.user_id = $2
       AND om.status = 'active'
       AND om.deleted_at IS NULL`,
    [orgId, userId]
  );

  if (result.rows.length === 0) {
    // Distinguish: check if org exists at all
    const orgResult = await queryReplica<{ status: string }>(
      'SELECT status FROM organizations WHERE id = $1',
      [orgId]
    );
    if (orgResult.rows.length === 0 || orgResult.rows[0].status === 'deleted') {
      throw new ForbiddenError('ORG_DELETED', 'Organization does not exist or has been deleted');
    }
    throw new ForbiddenError('NOT_ORG_MEMBER', 'User is not an active member of this organization');
  }

  const { role, org_status } = result.rows[0];

  if (org_status === 'deleted') {
    throw new ForbiddenError('ORG_DELETED', 'Organization has been deleted');
  }

  const context: OrgSessionCache = { orgId, orgStatus: org_status, memberRole: role };

  try {
    await redisClient.setex(cacheKey, SESSION_CACHE_TTL, JSON.stringify(context));
  } catch {
    // Redis failure — proceed without caching
  }

  return context;
}

export async function orgContextMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      throw new UnauthorizedError('MISSING_TOKEN', 'Authentication required');
    }

    const orgId = req.headers['x-org-id'] as string | undefined;
    if (!orgId) {
      throw new UnauthorizedError('MISSING_ORG_ID', 'X-Org-ID header is required');
    }

    // Platform admins may act on any org — skip orgId === user.orgId check
    if (!req.user.isPlatformAdmin && req.user.orgId !== orgId) {
      throw new ForbiddenError('ORG_MISMATCH', 'Token org does not match X-Org-ID header');
    }

    const context = await resolveOrgContext(req.user.userId, orgId);

    req.orgContext = {
      orgId: context.orgId,
      orgStatus: context.orgStatus,
      memberRole: context.memberRole,
    };

    next();
  } catch (err) {
    next(err);
  }
}
