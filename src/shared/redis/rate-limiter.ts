import { Request, Response, NextFunction } from 'express';
import { redisClient } from './clients';
import { logger } from '../observability/logger';
import { TooManyRequestsError } from '../errors/app-errors';

// In-process fallback store: key → [timestamps]
const fallbackStore = new Map<string, number[]>();

async function checkLimit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  const now = Date.now();
  const windowStart = now - windowMs;
  const redisKey = `rl:${key}`;

  try {
    const pipeline = redisClient.pipeline();
    pipeline.zremrangebyscore(redisKey, '-inf', windowStart);
    pipeline.zcard(redisKey);
    pipeline.zadd(redisKey, now, `${now}-${Math.random()}`);
    pipeline.pexpire(redisKey, windowMs);
    const results = await pipeline.exec();

    const count = (results?.[1]?.[1] as number) ?? 0;
    const allowed = count < limit;
    const remaining = Math.max(0, limit - count - 1);
    const retryAfter = allowed ? 0 : Math.ceil(windowMs / 1000);
    return { allowed, remaining, retryAfter };
  } catch (err) {
    logger.warn({ err, key }, 'Redis unavailable for rate limiting — falling back to in-process store (per-process only)');
    return checkLimitFallback(key, limit, windowMs, now, windowStart);
  }
}

function checkLimitFallback(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
  windowStart: number,
): { allowed: boolean; remaining: number; retryAfter: number } {
  const timestamps = (fallbackStore.get(key) ?? []).filter(ts => ts > windowStart);
  const count = timestamps.length;
  const allowed = count < limit;
  if (allowed) {
    timestamps.push(now);
    fallbackStore.set(key, timestamps);
  }
  const remaining = Math.max(0, limit - count - 1);
  const retryAfter = allowed ? 0 : Math.ceil(windowMs / 1000);
  return { allowed, remaining, retryAfter };
}

function makeRateLimitMiddleware(
  keyFn: (req: Request) => string,
  limit: number,
  windowMs: number,
) {
  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const key = keyFn(req);
    try {
      const { allowed, remaining, retryAfter } = await checkLimit(key, limit, windowMs);
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Window', Math.ceil(windowMs / 1000));
      if (!allowed) {
        res.setHeader('Retry-After', retryAfter);
        return next(new TooManyRequestsError(retryAfter));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** 10 req / 60s per IP — applied to /api/v1/auth/* */
export const authRateLimit = makeRateLimitMiddleware(
  (req) => `auth:${req.ip}`,
  10,
  60_000,
);

/** 300 req / 60s per user — applied to /api/v1/* */
export const apiRateLimit = makeRateLimitMiddleware(
  (req) => `api:user:${req.user?.userId ?? req.ip}`,
  300,
  60_000,
);

/** 3000 req / 60s per tenant — applied to /api/v1/* */
export const apiTenantRateLimit = makeRateLimitMiddleware(
  (req) => `api:tenant:${req.user?.orgId ?? 'anonymous'}`,
  3000,
  60_000,
);

/** 5 req / 60 min per IP — registration spam prevention */
export const registerRateLimit = makeRateLimitMiddleware(
  (req) => `register:${req.ip}`,
  5,
  60 * 60_000,
);

/** 5 req / 60 min per email — password-reset enumeration prevention */
export const passwordResetRateLimit = makeRateLimitMiddleware(
  (req) => `pwreset:${(req.body?.email as string | undefined)?.toLowerCase() ?? req.ip}`,
  5,
  60 * 60_000,
);

/** 5 req / 60 min per email — magic-link enumeration prevention */
export const magicLinkRateLimit = makeRateLimitMiddleware(
  (req) => `magiclink:${(req.body?.email as string | undefined)?.toLowerCase() ?? req.ip}`,
  5,
  60 * 60_000,
);

/** 3 req / 60 min per email — verify-email resend spam prevention */
export const verifyEmailResendRateLimit = makeRateLimitMiddleware(
  (req) => `verifyresend:${(req.body?.email as string | undefined)?.toLowerCase() ?? req.ip}`,
  3,
  60 * 60_000,
);

/** 60 events / 10s per user — for Socket.IO event handlers */
export const socketRateLimit = {
  checkLimit: (userId: string) => checkLimit(`socket:${userId}`, 60, 10_000),
};
