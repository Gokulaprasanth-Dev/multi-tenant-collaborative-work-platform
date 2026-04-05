import { redisClient } from '../redis/clients';

/**
 * SEC-NEW-005 fix: Redis sliding-window rate limiter for WebSocket events.
 * Returns true if the action is allowed, false if rate limit exceeded.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = now - windowMs;

  const pipeline = redisClient.pipeline();
  pipeline.zremrangebyscore(key, 0, windowStart);
  pipeline.zadd(key, now, `${now}-${Math.random()}`);
  pipeline.zcard(key);
  pipeline.expire(key, windowSeconds + 1);
  const results = await pipeline.exec();

  if (!results) return false;

  // zcard result is at index 2
  const cardResult = results[2];
  if (!cardResult || cardResult[0]) return false;

  const count = cardResult[1] as number;
  return count <= limit;
}
