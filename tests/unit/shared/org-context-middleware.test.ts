/**
 * Unit tests for shared/auth-middleware/org-context.middleware.ts
 *
 * Covers:
 * - missing req.user → 401 MISSING_TOKEN
 * - missing X-Org-ID header → 401 MISSING_ORG_ID
 * - token orgId mismatch with X-Org-ID (non-admin) → 403 ORG_MISMATCH
 * - platform admin can bypass orgId mismatch check
 * - user not a member of org → 403 NOT_ORG_MEMBER
 * - org deleted → 403 ORG_DELETED
 * - valid membership → attaches req.orgContext and calls next()
 * - uses Redis cache when available
 * - falls through to DB on Redis cache miss
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const mockRedisGet = jest.fn();
const mockRedisSetex = jest.fn();

jest.mock('../../../src/shared/redis/clients', () => ({
  redisClient: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    setex: (...args: unknown[]) => mockRedisSetex(...args),
  },
}));

const mockQueryReplica = jest.fn();
jest.mock('../../../src/shared/database/pool', () => ({
  queryReplica: (...args: unknown[]) => mockQueryReplica(...args),
  queryPrimary: jest.fn(),
}));

import { Request, Response, NextFunction } from 'express';
import { orgContextMiddleware } from '../../../src/shared/auth-middleware/org-context.middleware';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<{
  user: object | null;
  orgIdHeader: string | undefined;
  isPlatformAdmin: boolean;
  tokenOrgId: string;
}>  = {}): Request {
  const { user, orgIdHeader, isPlatformAdmin = false, tokenOrgId = 'org-1' } = overrides;
  const req: any = {
    headers: orgIdHeader !== undefined ? { 'x-org-id': orgIdHeader } : {},
  };
  if (user !== null) {
    req.user = user ?? {
      userId: 'user-1',
      orgId: tokenOrgId,
      role: 'member',
      isPlatformAdmin,
      jti: 'jti-1',
      exp: Math.floor(Date.now() / 1000) + 900,
    };
  }
  return req as Request;
}

const next: jest.Mock = jest.fn();
const res: Response = {} as Response;

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSetex.mockResolvedValue('OK');
  // Default: active membership
  mockQueryReplica.mockResolvedValue({ rows: [{ role: 'member', org_status: 'active' }] });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('orgContextMiddleware', () => {
  it('calls next(UnauthorizedError) when req.user is missing', async () => {
    const req: any = { headers: { 'x-org-id': 'org-1' } };
    await orgContextMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'MISSING_TOKEN' }));
  });

  it('calls next(UnauthorizedError) when X-Org-ID header is missing', async () => {
    const req = makeReq({ orgIdHeader: undefined });
    await orgContextMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'MISSING_ORG_ID' }));
  });

  it('calls next(ForbiddenError) when token orgId mismatches X-Org-ID for non-admin', async () => {
    const req = makeReq({ orgIdHeader: 'org-other', tokenOrgId: 'org-1' });
    await orgContextMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'ORG_MISMATCH' }));
  });

  it('allows platform admin to access a different org (bypasses mismatch check)', async () => {
    const req = makeReq({ orgIdHeader: 'org-2', tokenOrgId: 'org-admin', isPlatformAdmin: true });
    await orgContextMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith(); // no error
    expect((req as any).orgContext).toBeDefined();
  });

  it('calls next(ForbiddenError) NOT_ORG_MEMBER when user has no membership', async () => {
    // membership query returns no rows → check if org exists
    mockQueryReplica
      .mockResolvedValueOnce({ rows: [] })                         // membership query
      .mockResolvedValueOnce({ rows: [{ status: 'active' }] });   // org exists
    const req = makeReq({ orgIdHeader: 'org-1' });
    await orgContextMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_ORG_MEMBER' }));
  });

  it('calls next(ForbiddenError) ORG_DELETED when org does not exist', async () => {
    mockQueryReplica
      .mockResolvedValueOnce({ rows: [] })   // membership query
      .mockResolvedValueOnce({ rows: [] });  // org not found
    const req = makeReq({ orgIdHeader: 'org-1' });
    await orgContextMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'ORG_DELETED' }));
  });

  it('calls next(ForbiddenError) ORG_DELETED when org.status is deleted', async () => {
    mockQueryReplica
      .mockResolvedValueOnce({ rows: [] })                            // membership query
      .mockResolvedValueOnce({ rows: [{ status: 'deleted' }] });     // org found but deleted
    const req = makeReq({ orgIdHeader: 'org-1' });
    await orgContextMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'ORG_DELETED' }));
  });

  it('attaches req.orgContext and calls next() for active membership', async () => {
    mockQueryReplica.mockResolvedValue({ rows: [{ role: 'org_admin', org_status: 'active' }] });
    const req = makeReq({ orgIdHeader: 'org-1' });
    await orgContextMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect((req as any).orgContext).toEqual({
      orgId: 'org-1',
      orgStatus: 'active',
      memberRole: 'org_admin',
    });
  });

  it('uses cached session when Redis has the key', async () => {
    const cached = JSON.stringify({ orgId: 'org-1', orgStatus: 'active', memberRole: 'member' });
    mockRedisGet.mockResolvedValue(cached);
    const req = makeReq({ orgIdHeader: 'org-1' });
    await orgContextMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
    // DB should NOT have been queried
    expect(mockQueryReplica).not.toHaveBeenCalled();
    expect((req as any).orgContext.memberRole).toBe('member');
  });

  it('falls through to DB query on Redis cache miss', async () => {
    mockRedisGet.mockResolvedValue(null); // cache miss
    mockQueryReplica.mockResolvedValue({ rows: [{ role: 'org_owner', org_status: 'active' }] });
    const req = makeReq({ orgIdHeader: 'org-1' });
    await orgContextMiddleware(req, res, next);
    expect(mockQueryReplica).toHaveBeenCalled();
    expect((req as any).orgContext.memberRole).toBe('org_owner');
  });

  it('proceeds even when Redis setex fails (caching is best-effort)', async () => {
    mockRedisSetex.mockRejectedValue(new Error('Redis down'));
    const req = makeReq({ orgIdHeader: 'org-1' });
    await orgContextMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
