/**
 * Integration test: auth rate limiter middleware
 *
 * Tests the authRateLimit middleware directly using a minimal Express app
 * (bypasses the NODE_ENV !== 'test' guard on the auth router).
 *
 * The auth rate limiter allows 10 req/60s per IP.
 * We flush the Redis rate-limit key first to start from zero.
 */

import express from 'express';
import request from 'supertest';
import { redisClient } from '../../../src/shared/redis/clients';
import { authRateLimit } from '../../../src/shared/redis/rate-limiter';
import { errorHandlerMiddleware } from '../../../src/shared/errors/error-handler.middleware';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

// Minimal app that applies authRateLimit directly so tests aren't affected
// by the NODE_ENV !== 'test' guard on the real auth router.
function makeTestApp() {
  const testApp = express();
  testApp.set('trust proxy', 'loopback');
  testApp.use(express.json());
  testApp.post('/probe', authRateLimit, (_req, res) => res.status(200).json({ ok: true }));
  testApp.use(errorHandlerMiddleware);
  return testApp;
}

maybeDescribe('Auth rate limiting', () => {
  it('returns 429 after exceeding limit (10 req/60s per IP)', async () => {
    const testApp = makeTestApp();
    // Use a unique fake IP per test to avoid interference
    const testIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

    // Clear any existing rate limit key
    const possibleKeys = [
      `rl:auth:${testIp}`,
      `rl:auth:::ffff:${testIp}`,
    ];
    for (const k of possibleKeys) await redisClient.del(k);

    let lastStatus = 0;

    // Send 11 requests — the 11th should be 429
    for (let i = 0; i < 11; i++) {
      const res = await request(testApp)
        .post('/probe')
        .set('X-Forwarded-For', testIp);

      if (i < 10) {
        // First 10: allowed (200)
        expect(res.status).not.toBe(429);
      }
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);

    // Cleanup
    for (const k of possibleKeys) await redisClient.del(k);
  }, 30000);

  it('sets X-RateLimit-Limit and X-RateLimit-Remaining headers', async () => {
    const testApp = makeTestApp();
    const testIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    await redisClient.del(`rl:auth:${testIp}`);
    await redisClient.del(`rl:auth:::ffff:${testIp}`);

    const res = await request(testApp)
      .post('/probe')
      .set('X-Forwarded-For', testIp);

    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(parseInt(res.headers['x-ratelimit-limit'] as string, 10)).toBe(10);
  });

  it('different IPs are rate-limited independently', async () => {
    const testApp = makeTestApp();
    const ipA = `198.51.100.${Math.floor(Math.random() * 100) + 1}`;
    const ipB = `198.51.100.${Math.floor(Math.random() * 100) + 101}`;

    for (const ip of [ipA, ipB, `::ffff:${ipA}`, `::ffff:${ipB}`]) {
      await redisClient.del(`rl:auth:${ip}`);
    }

    // Exhaust IP A
    for (let i = 0; i < 11; i++) {
      await request(testApp)
        .post('/probe')
        .set('X-Forwarded-For', ipA);
    }

    // IP B should still be allowed (not 429)
    const resB = await request(testApp)
      .post('/probe')
      .set('X-Forwarded-For', ipB);

    expect(resB.status).not.toBe(429);
  }, 30000);
});
