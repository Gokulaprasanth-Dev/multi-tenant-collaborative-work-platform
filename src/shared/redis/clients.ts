import Redis from 'ioredis';
import { logger } from '../observability/logger';

function createRedisClient(name: string): Redis {
  const onConnect = () => logger.info({ client: name }, 'Redis connected');
  const onError = (err: Error) => logger.error({ err, client: name }, 'Redis error');
  const onClose = () => logger.warn({ client: name }, 'Redis connection closed');

  // Sentinel mode when REDIS_SENTINEL_HOSTS is set
  if (process.env.REDIS_SENTINEL_HOSTS) {
    const sentinels = process.env.REDIS_SENTINEL_HOSTS.split(',').map(h => {
      const [host, portStr] = h.trim().split(':');
      return { host, port: parseInt(portStr || '26379', 10) };
    });
    const client = new Redis({
      sentinels, name: 'mymaster',
      password: process.env.REDIS_PASSWORD,
      lazyConnect: false, maxRetriesPerRequest: 3,
    });
    client.on('connect', onConnect).on('error', onError).on('close', onClose);
    return client;
  }

  // Standalone mode
  const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    password: process.env.REDIS_PASSWORD,
    lazyConnect: false, maxRetriesPerRequest: 3, enableReadyCheck: true,
  });
  client.on('connect', onConnect).on('error', onError).on('close', onClose);
  return client;
}

/**
 * General-purpose: GET, SET, DEL, PUBLISH, rate limiting.
 * The outbox poller MUST use this for PUBLISH — not redisPubSubClient.
 */
export const redisClient = createRedisClient('redisClient');

/**
 * Subscribe-mode ONLY. After first SUBSCRIBE, this client CANNOT issue
 * PUBLISH or any other non-subscribe command (Redis protocol error).
 */
export const redisPubSubClient = createRedisClient('redisPubSubClient');

/** Dedicated pub client for @socket.io/redis-adapter. */
export const redisAdapterPubClient = createRedisClient('redisAdapterPubClient');

/** Dedicated sub client for @socket.io/redis-adapter. */
export const redisAdapterSubClient = createRedisClient('redisAdapterSubClient');

export async function closeAllRedisClients(): Promise<void> {
  await Promise.all([
    redisClient.quit(),
    redisPubSubClient.quit(),
    redisAdapterPubClient.quit(),
    redisAdapterSubClient.quit(),
  ]);
}
