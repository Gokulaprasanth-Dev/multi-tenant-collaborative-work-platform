/**
 * Integration test for the WebSocket rate limiter (SEC-NEW-005)
 *
 * Tests checkRateLimit() directly against a real Redis instance.
 * This is more reliable than testing through the full Socket.IO stack
 * because the Redis adapter's broadcast mechanism doesn't interfere.
 */

import { checkRateLimit } from '../../../src/shared/realtime/rate-limiter';
import { redisClient } from '../../../src/shared/redis/clients';

const RUN_INTEGRATION = Boolean(process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('WebSocket checkRateLimit (SEC-NEW-005)', () => {
  afterEach(async () => {
    // Clean up test keys
    const keys = await redisClient.keys('test:rl:*');
    if (keys.length > 0) await redisClient.del(...keys);
  });

  it('allows requests up to limit', async () => {
    const key = `test:rl:allow:${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      const allowed = await checkRateLimit(key, 5, 60);
      expect(allowed).toBe(true);
    }
  });

  it('blocks the (limit+1)th request', async () => {
    const key = `test:rl:block:${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(key, 5, 60);
    }
    const blocked = await checkRateLimit(key, 5, 60);
    expect(blocked).toBe(false);
  });

  it('different keys are rate-limited independently', async () => {
    const keyA = `test:rl:indepA:${Date.now()}`;
    const keyB = `test:rl:indepB:${Date.now()}`;

    // Exhaust key A
    for (let i = 0; i < 5; i++) await checkRateLimit(keyA, 5, 60);
    expect(await checkRateLimit(keyA, 5, 60)).toBe(false);

    // Key B should still be allowed
    expect(await checkRateLimit(keyB, 5, 60)).toBe(true);
  });

  it('window expiry resets the counter', async () => {
    const key = `test:rl:expire:${Date.now()}`;
    // Use a 1-second window
    for (let i = 0; i < 3; i++) await checkRateLimit(key, 3, 1);
    expect(await checkRateLimit(key, 3, 1)).toBe(false);

    // Wait for the window to expire
    await new Promise(r => setTimeout(r, 1100));

    // Now it should be allowed again
    expect(await checkRateLimit(key, 3, 1)).toBe(true);
  });

  it('uses sliding window — stale entries are pruned', async () => {
    const key = `test:rl:sliding:${Date.now()}`;
    // Allow 2 per 1s window
    expect(await checkRateLimit(key, 2, 1)).toBe(true);  // count=1
    expect(await checkRateLimit(key, 2, 1)).toBe(true);  // count=2
    expect(await checkRateLimit(key, 2, 1)).toBe(false); // count=3, blocked

    // After 1s the first entries expire, so 1 new request should be allowed
    await new Promise(r => setTimeout(r, 1100));
    expect(await checkRateLimit(key, 2, 1)).toBe(true);  // old entries pruned
  });
});
