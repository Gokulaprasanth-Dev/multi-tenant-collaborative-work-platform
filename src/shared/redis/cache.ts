/**
 * Instrumented Redis cache helpers.
 * Increments redis_cache_hits_total / redis_cache_misses_total on every get.
 */
import { redisClient } from './clients';
import { redisCacheHits, redisCacheMisses } from '../observability/metrics';

export async function cacheGet(key: string): Promise<string | null> {
  const value = await redisClient.get(key);
  if (value !== null) {
    redisCacheHits.inc();
  } else {
    redisCacheMisses.inc();
  }
  return value;
}

export async function cacheSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  if (ttlSeconds) {
    await redisClient.set(key, value, 'EX', ttlSeconds);
  } else {
    await redisClient.set(key, value);
  }
}

export async function cacheDel(key: string): Promise<void> {
  await redisClient.del(key);
}
