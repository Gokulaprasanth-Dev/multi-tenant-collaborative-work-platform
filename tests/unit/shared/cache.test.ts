/**
 * Unit tests for src/shared/redis/cache.ts
 *
 * Covers:
 * - cacheGet returns value on hit and increments redisCacheHits
 * - cacheGet returns null on miss and increments redisCacheMisses
 * - cacheSet calls redisClient.set without TTL
 * - cacheSet calls redisClient.set with EX + ttlSeconds when provided
 * - cacheDel calls redisClient.del with the given key
 */

jest.mock('../../../src/shared/redis/clients', () => ({
  redisClient: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock('../../../src/shared/observability/metrics', () => ({
  redisCacheHits: { inc: jest.fn() },
  redisCacheMisses: { inc: jest.fn() },
  // stub remaining exports that metrics.ts may re-export at module level
  registry: {},
  httpRequestDuration: { observe: jest.fn() },
  httpRequestsTotal: { inc: jest.fn() },
  bullmqQueueDepth: { set: jest.fn() },
  bullmqDlqDepth: { set: jest.fn() },
  bullmqJobsCompleted: { inc: jest.fn() },
  bullmqJobsFailed: { inc: jest.fn() },
  outboxPendingEvents: { set: jest.fn() },
  searchIndexLagSeconds: { set: jest.fn() },
  dbPoolConnectionsActive: { set: jest.fn() },
  dbQueryDuration: { observe: jest.fn() },
  socketConnectionsActive: { set: jest.fn() },
  paymentWebhookProcessed: { inc: jest.fn() },
  httpMetricsMiddleware: jest.fn(),
  metricsAuthMiddleware: jest.fn(),
  collectQueueMetrics: jest.fn(),
  startQueueMetricsCollection: jest.fn(),
}));

import { cacheGet, cacheSet, cacheDel } from '../../../src/shared/redis/cache';
import { redisClient } from '../../../src/shared/redis/clients';
import { redisCacheHits, redisCacheMisses } from '../../../src/shared/observability/metrics';

const mockGet = redisClient.get as jest.MockedFunction<typeof redisClient.get>;
const mockSet = redisClient.set as jest.MockedFunction<typeof redisClient.set>;
const mockDel = redisClient.del as jest.MockedFunction<typeof redisClient.del>;
const mockHits = redisCacheHits.inc as jest.MockedFunction<typeof redisCacheHits.inc>;
const mockMisses = redisCacheMisses.inc as jest.MockedFunction<typeof redisCacheMisses.inc>;

describe('cacheGet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the value when Redis has it', async () => {
    mockGet.mockResolvedValue('cached-value');

    const result = await cacheGet('some:key');

    expect(result).toBe('cached-value');
    expect(mockGet).toHaveBeenCalledWith('some:key');
  });

  it('increments redisCacheHits when value is found', async () => {
    mockGet.mockResolvedValue('hit');

    await cacheGet('some:key');

    expect(mockHits).toHaveBeenCalledTimes(1);
    expect(mockMisses).not.toHaveBeenCalled();
  });

  it('returns null when Redis returns null', async () => {
    mockGet.mockResolvedValue(null);

    const result = await cacheGet('missing:key');

    expect(result).toBeNull();
  });

  it('increments redisCacheMisses when value is not found', async () => {
    mockGet.mockResolvedValue(null);

    await cacheGet('missing:key');

    expect(mockMisses).toHaveBeenCalledTimes(1);
    expect(mockHits).not.toHaveBeenCalled();
  });
});

describe('cacheSet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls redisClient.set with key and value when no TTL is provided', async () => {
    mockSet.mockResolvedValue('OK' as never);

    await cacheSet('my:key', 'my-value');

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith('my:key', 'my-value');
  });

  it('calls redisClient.set with EX and ttlSeconds when ttlSeconds is provided', async () => {
    mockSet.mockResolvedValue('OK' as never);

    await cacheSet('my:key', 'my-value', 300);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith('my:key', 'my-value', 'EX', 300);
  });
});

describe('cacheDel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls redisClient.del with the given key', async () => {
    mockDel.mockResolvedValue(1 as never);

    await cacheDel('delete:me');

    expect(mockDel).toHaveBeenCalledTimes(1);
    expect(mockDel).toHaveBeenCalledWith('delete:me');
  });
});
