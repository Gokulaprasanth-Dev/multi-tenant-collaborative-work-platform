/**
 * Unit tests for shared/auth-middleware/jwt.middleware.ts
 *
 * Covers:
 * - jwtMiddleware: missing/malformed Authorization header → 401 MISSING_TOKEN
 * - jwtMiddleware: invalid/expired token → 401 INVALID_TOKEN
 * - jwtMiddleware: token jti is blacklisted → 401 TOKEN_BLACKLISTED
 * - jwtMiddleware: user not found → 401 USER_NOT_FOUND
 * - jwtMiddleware: user is deleted → 401 USER_DELETED
 * - jwtMiddleware: token issued before password change → 401 SESSION_INVALIDATED
 * - jwtMiddleware: valid token → attaches req.user and calls next()
 * - optionalJwtMiddleware: no header → calls next() without setting req.user
 * - optionalJwtMiddleware: invalid token → ignores error and calls next()
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────
// All consts referenced inside jest.mock factories must be defined inside the factory
// (jest.mock is hoisted above all imports and variable declarations)

jest.mock('../../../src/shared/config', () => {
  const crypto = require('crypto');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    config: {
      jwtPublicKey: publicKey.export({ type: 'pkcs1', format: 'pem' }),
      jwtPrivateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }),
      jwtAccessTokenTtl: 900,
      encryptionKey: 'a'.repeat(64),
      inviteSecret: 'x'.repeat(32),
      metricsToken: 'x'.repeat(16),
      logLevel: 'info',
      nodeEnv: 'test',
    },
  };
});

const mockRedisGet = jest.fn();
const mockRedisSetex = jest.fn();

jest.mock('../../../src/shared/redis/clients', () => ({
  redisClient: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    setex: (...args: unknown[]) => mockRedisSetex(...args),
  },
}));

const mockDbQuery = jest.fn();
jest.mock('../../../src/shared/database/pool', () => ({
  primaryPool: { query: (...args: unknown[]) => mockDbQuery(...args) },
  queryPrimary: jest.fn(),
  queryReplica: jest.fn(),
}));

import * as crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { jwtMiddleware, optionalJwtMiddleware } from '../../../src/shared/auth-middleware/jwt.middleware';
import { config } from '../../../src/shared/config';

// ── Helpers ───────────────────────────────────────────────────────────────────

function signToken(payload: object, expiresIn = '15m') {
  // Sign with the same private key the config mock provides
  return jwt.sign(payload, config.jwtPrivateKey, { algorithm: 'RS256', expiresIn, keyid: 'default' } as any);
}

function makeReq(token?: string): Request {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as unknown as Request;
}

function makeRes(): Response {
  return {} as unknown as Response;
}

const next: jest.Mock = jest.fn();

function validUser() {
  return { id: 'user-1', status: 'active', password_changed_at: null };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSetex.mockResolvedValue('OK');
  mockDbQuery.mockResolvedValue({ rows: [validUser()] });
});

// ── jwtMiddleware ─────────────────────────────────────────────────────────────

describe('jwtMiddleware', () => {
  it('calls next(UnauthorizedError) when Authorization header is missing', async () => {
    const req = makeReq();
    await jwtMiddleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'MISSING_TOKEN' }));
  });

  it('calls next(UnauthorizedError) when Authorization header lacks Bearer prefix', async () => {
    const req = { headers: { authorization: 'Basic abc' } } as unknown as Request;
    await jwtMiddleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'MISSING_TOKEN' }));
  });

  it('calls next(UnauthorizedError) when token is invalid', async () => {
    const req = makeReq('not.a.valid.jwt');
    await jwtMiddleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_TOKEN' }));
  });

  it('calls next(UnauthorizedError) when token jti is blacklisted', async () => {
    const token = signToken({ sub: 'user-1', orgId: 'org-1', role: 'member', jti: 'jti-1' });
    // First get: blacklist check returns '1' → blacklisted
    mockRedisGet.mockResolvedValue('1');
    const req = makeReq(token);
    await jwtMiddleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_BLACKLISTED' }));
  });

  it('calls next(UnauthorizedError) when user is not found in DB', async () => {
    const token = signToken({ sub: 'user-ghost', orgId: 'org-1', role: 'member', jti: 'jti-2' });
    mockDbQuery.mockResolvedValue({ rows: [] }); // user not found
    const req = makeReq(token);
    await jwtMiddleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'USER_NOT_FOUND' }));
  });

  it('calls next(UnauthorizedError) when user status is deleted', async () => {
    const token = signToken({ sub: 'user-1', orgId: 'org-1', role: 'member', jti: 'jti-3' });
    mockDbQuery.mockResolvedValue({ rows: [{ id: 'user-1', status: 'deleted', password_changed_at: null }] });
    const req = makeReq(token);
    await jwtMiddleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'USER_DELETED' }));
  });

  it('calls next(UnauthorizedError) when token issued before password change', async () => {
    // password_changed_at is in the future relative to now → token iat is in the past
    const futureChange = new Date(Date.now() + 60_000).toISOString();
    mockDbQuery.mockResolvedValue({ rows: [{ id: 'user-1', status: 'active', password_changed_at: futureChange }] });
    const token = signToken({ sub: 'user-1', orgId: 'org-1', role: 'member', jti: 'jti-4' });
    const req = makeReq(token);
    await jwtMiddleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'SESSION_INVALIDATED' }));
  });

  it('calls next() and attaches req.user for a valid token', async () => {
    const token = signToken({ sub: 'user-1', orgId: 'org-1', role: 'member', jti: 'jti-5' });
    const req = makeReq(token);
    await jwtMiddleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(); // no error argument
    expect((req as any).user).toMatchObject({
      userId: 'user-1',
      orgId: 'org-1',
      role: 'member',
    });
  });

  it('fails open (succeeds) when Redis is unavailable for blacklist check', async () => {
    const token = signToken({ sub: 'user-1', orgId: 'org-1', role: 'member', jti: 'jti-6' });
    mockRedisGet.mockRejectedValue(new Error('Redis down'));
    const req = makeReq(token);
    await jwtMiddleware(req, makeRes(), next);
    // Should succeed despite Redis failure (fail-open)
    expect(next).toHaveBeenCalledWith();
  });
});

// ── optionalJwtMiddleware ─────────────────────────────────────────────────────

describe('optionalJwtMiddleware', () => {
  it('calls next() without setting req.user when no Authorization header', async () => {
    const req = makeReq();
    await optionalJwtMiddleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect((req as any).user).toBeUndefined();
  });

  it('ignores invalid token and calls next() without req.user', async () => {
    const req = makeReq('invalid.token.here');
    await optionalJwtMiddleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect((req as any).user).toBeUndefined();
  });

  it('attaches req.user when token is valid', async () => {
    const token = signToken({ sub: 'user-1', orgId: 'org-1', role: 'member', jti: 'jti-7' });
    const req = makeReq(token);
    await optionalJwtMiddleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect((req as any).user).toBeDefined();
  });
});
