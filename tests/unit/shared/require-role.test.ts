/**
 * Unit tests for requireRole middleware
 *
 * Covers:
 * - passes through when user has a required role
 * - calls next(ForbiddenError) when role is insufficient
 * - calls next(ForbiddenError) when no orgContext (no role)
 * - works with multiple allowed roles
 */

import { Request, Response, NextFunction } from 'express';
import { requireRole } from '../../../src/shared/auth-middleware/require-role.middleware';
import { ForbiddenError } from '../../../src/shared/errors/app-errors';

function makeReq(memberRole?: string): Request {
  return {
    orgContext: memberRole ? { orgId: 'org-1', orgStatus: 'active', memberRole } : undefined,
  } as unknown as Request;
}

const res = {} as Response;

describe('requireRole', () => {
  it('calls next() with no error when role matches', () => {
    const next = jest.fn() as NextFunction;
    requireRole(['admin'])(makeReq('admin'), res, next);
    expect(next).toHaveBeenCalledWith(); // no args = pass through
  });

  it('allows any of multiple accepted roles', () => {
    const next = jest.fn() as NextFunction;
    requireRole(['admin', 'org_owner'])(makeReq('org_owner'), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(ForbiddenError) with INSUFFICIENT_ROLE when role does not match', () => {
    const next = jest.fn() as NextFunction;
    requireRole(['admin'])(makeReq('member'), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    const err = (next as jest.Mock).mock.calls[0][0] as ForbiddenError;
    expect(err.code).toBe('INSUFFICIENT_ROLE');
  });

  it('calls next(ForbiddenError) when orgContext is absent', () => {
    const next = jest.fn() as NextFunction;
    requireRole(['admin'])(makeReq(), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    const err = (next as jest.Mock).mock.calls[0][0] as ForbiddenError;
    expect(err.code).toBe('INSUFFICIENT_ROLE');
  });

  it('includes the required roles in the error message', () => {
    const next = jest.fn() as NextFunction;
    requireRole(['admin', 'org_owner'])(makeReq('member'), res, next);
    const err = (next as jest.Mock).mock.calls[0][0] as ForbiddenError;
    expect(err.message).toContain('admin');
    expect(err.message).toContain('org_owner');
  });
});
