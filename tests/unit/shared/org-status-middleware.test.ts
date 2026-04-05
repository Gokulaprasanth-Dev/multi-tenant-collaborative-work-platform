/**
 * Unit tests for orgStatusMiddleware
 *
 * Covers:
 * - deleted org → 403 ORG_DELETED on any method
 * - offboarding org + write method → 403 ORG_OFFBOARDING
 * - offboarding org + GET → allowed
 * - suspended org + write (non-bypass path) → 403 ORG_SUSPENDED
 * - suspended org + GET → allowed
 * - suspended org + POST to /api/v1/auth → allowed (bypass)
 * - active org → allowed on any method
 * - no orgContext → pass-through
 */

import { Request, Response, NextFunction } from 'express';
import { orgStatusMiddleware } from '../../../src/shared/auth-middleware/org-status.middleware';
import { ForbiddenError } from '../../../src/shared/errors/app-errors';

function makeReq(method: string, path: string, orgStatus?: string): Request {
  return {
    method,
    path,
    orgContext: orgStatus ? { orgId: 'org-1', orgStatus, memberRole: 'member' } : undefined,
  } as unknown as Request;
}

const res = {} as Response;

describe('orgStatusMiddleware', () => {
  // ── deleted org ───────────────────────────────────────────────────────────

  it('blocks GET on deleted org', () => {
    const next = jest.fn() as NextFunction;
    orgStatusMiddleware(makeReq('GET', '/api/v1/orgs/org-1/tasks', 'deleted'), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    const err = (next as jest.Mock).mock.calls[0][0] as ForbiddenError;
    expect(err.code).toBe('ORG_DELETED');
  });

  it('blocks POST on deleted org', () => {
    const next = jest.fn() as NextFunction;
    orgStatusMiddleware(makeReq('POST', '/api/v1/orgs/org-1/tasks', 'deleted'), res, next);
    const err = (next as jest.Mock).mock.calls[0][0] as ForbiddenError;
    expect(err.code).toBe('ORG_DELETED');
  });

  // ── offboarding org ───────────────────────────────────────────────────────

  it('blocks POST on offboarding org', () => {
    const next = jest.fn() as NextFunction;
    orgStatusMiddleware(makeReq('POST', '/api/v1/orgs/org-1/tasks', 'offboarding'), res, next);
    const err = (next as jest.Mock).mock.calls[0][0] as ForbiddenError;
    expect(err.code).toBe('ORG_OFFBOARDING');
  });

  it('blocks PATCH on offboarding org', () => {
    const next = jest.fn() as NextFunction;
    orgStatusMiddleware(makeReq('PATCH', '/api/v1/orgs/org-1/tasks/t-1', 'offboarding'), res, next);
    const err = (next as jest.Mock).mock.calls[0][0] as ForbiddenError;
    expect(err.code).toBe('ORG_OFFBOARDING');
  });

  it('allows GET on offboarding org', () => {
    const next = jest.fn() as NextFunction;
    orgStatusMiddleware(makeReq('GET', '/api/v1/orgs/org-1/tasks', 'offboarding'), res, next);
    expect(next).toHaveBeenCalledWith(); // no error
  });

  // ── suspended org ─────────────────────────────────────────────────────────

  it('blocks POST on suspended org for non-bypass path', () => {
    const next = jest.fn() as NextFunction;
    orgStatusMiddleware(makeReq('POST', '/api/v1/orgs/org-1/tasks', 'suspended'), res, next);
    const err = (next as jest.Mock).mock.calls[0][0] as ForbiddenError;
    expect(err.code).toBe('ORG_SUSPENDED');
  });

  it('blocks DELETE on suspended org', () => {
    const next = jest.fn() as NextFunction;
    orgStatusMiddleware(makeReq('DELETE', '/api/v1/orgs/org-1/tasks/t-1', 'suspended'), res, next);
    const err = (next as jest.Mock).mock.calls[0][0] as ForbiddenError;
    expect(err.code).toBe('ORG_SUSPENDED');
  });

  it('allows GET on suspended org', () => {
    const next = jest.fn() as NextFunction;
    orgStatusMiddleware(makeReq('GET', '/api/v1/orgs/org-1/tasks', 'suspended'), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows POST to /api/v1/auth on suspended org (bypass)', () => {
    const next = jest.fn() as NextFunction;
    orgStatusMiddleware(makeReq('POST', '/api/v1/auth/login', 'suspended'), res, next);
    expect(next).toHaveBeenCalledWith(); // bypass — no error
  });

  it('allows POST to /api/v1/auth/refresh on suspended org (bypass)', () => {
    const next = jest.fn() as NextFunction;
    orgStatusMiddleware(makeReq('POST', '/api/v1/auth/refresh', 'suspended'), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  // ── active org ────────────────────────────────────────────────────────────

  it('allows POST on active org', () => {
    const next = jest.fn() as NextFunction;
    orgStatusMiddleware(makeReq('POST', '/api/v1/orgs/org-1/tasks', 'active'), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows DELETE on active org', () => {
    const next = jest.fn() as NextFunction;
    orgStatusMiddleware(makeReq('DELETE', '/api/v1/orgs/org-1/tasks/t-1', 'active'), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  // ── no orgContext ─────────────────────────────────────────────────────────

  it('passes through when no orgContext (unauthenticated/pre-auth routes)', () => {
    const next = jest.fn() as NextFunction;
    orgStatusMiddleware(makeReq('POST', '/api/v1/auth/register'), res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
