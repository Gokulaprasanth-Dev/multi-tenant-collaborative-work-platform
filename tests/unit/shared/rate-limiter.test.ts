/**
 * Unit tests for the rate limiter in-process fallback
 *
 * Tests the fallback store behavior (used when Redis is unavailable).
 * Integration tests for rate limiting are done via auth endpoint load.
 */

import { Request, Response, NextFunction } from 'express';

// Mock Redis to be unavailable so fallback is triggered
jest.mock('../../../src/shared/redis/clients', () => ({
  redisClient: {
    pipeline: () => {
      throw new Error('Redis unavailable');
    },
    duplicate: jest.fn(),
    quit: jest.fn(),
  },
}));

// Import after mock is set
import { authRateLimit } from '../../../src/shared/redis/rate-limiter';
import { TooManyRequestsError } from '../../../src/shared/errors/app-errors';

function makeReq(ip = '127.0.0.1'): Request {
  return { ip, user: undefined, headers: {}, query: {}, body: {} } as unknown as Request;
}

function makeRes(): Response {
  const res: Partial<Response> = { setHeader: jest.fn() };
  return res as Response;
}

describe('Rate limiter (in-process fallback)', () => {
  beforeEach(() => {
    // Reset module to clear in-process fallback store between tests
    jest.resetModules();
  });

  it('allows requests below limit', async () => {
    const req = makeReq('10.0.0.1');
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await authRateLimit(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(next).not.toHaveBeenCalledWith(expect.any(Error));
  });

  it('sets X-RateLimit-Limit header', async () => {
    const req = makeReq('10.0.0.2');
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await authRateLimit(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', expect.any(Number));
  });

  it('sets X-RateLimit-Remaining header (decrements with each request)', async () => {
    const ip = '10.0.0.3';
    const res1 = makeRes();
    const res2 = makeRes();
    const next = jest.fn() as NextFunction;

    await authRateLimit(makeReq(ip), res1, next);
    await authRateLimit(makeReq(ip), res2, next);

    const remaining1 = (res1.setHeader as jest.Mock).mock.calls
      .find(([k]) => k === 'X-RateLimit-Remaining')?.[1] as number;
    const remaining2 = (res2.setHeader as jest.Mock).mock.calls
      .find(([k]) => k === 'X-RateLimit-Remaining')?.[1] as number;

    expect(remaining1).toBeGreaterThan(remaining2);
  });

  it('blocks after limit is exceeded (TooManyRequestsError)', async () => {
    const ip = '10.0.0.4';
    const next = jest.fn() as NextFunction;

    // authRateLimit allows 10 req / 60s
    for (let i = 0; i < 10; i++) {
      await authRateLimit(makeReq(ip), makeRes(), next);
    }

    // 11th request should be blocked
    await authRateLimit(makeReq(ip), makeRes(), next);

    const lastCall = (next as jest.Mock).mock.calls.at(-1);
    expect(lastCall?.[0]).toBeInstanceOf(TooManyRequestsError);
    expect((lastCall?.[0] as TooManyRequestsError).statusCode).toBe(429);
  });

  it('different IPs have independent limits', async () => {
    const next = jest.fn() as NextFunction;

    // Exhaust limit for ip A
    for (let i = 0; i < 10; i++) {
      await authRateLimit(makeReq('192.168.1.1'), makeRes(), next);
    }
    await authRateLimit(makeReq('192.168.1.1'), makeRes(), next);

    // IP B should still be allowed
    const nextB = jest.fn() as NextFunction;
    await authRateLimit(makeReq('192.168.1.2'), makeRes(), nextB);

    expect(nextB).toHaveBeenCalledWith();
    expect(nextB).not.toHaveBeenCalledWith(expect.any(Error));
  });
});
