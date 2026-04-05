/**
 * Integration tests for presence.service.ts
 *
 * Tests the Redis-backed presence and typing indicator operations.
 * Requires a live Redis connection.
 *
 * Covers:
 * - setOnline/setOffline: correctly stores and removes presence state
 * - getStatus: returns 'online' or 'offline' based on Redis state
 * - heartbeat: refreshes TTL for online user
 * - setTyping/clearTyping/getTypingUsers: typing indicator lifecycle
 * - Isolated by org/channel to prevent test cross-contamination
 */

import { v4 as uuidv4 } from 'uuid';
import { redisClient } from '../../../src/shared/redis/clients';
import {
  setOnline,
  setOffline,
  heartbeat,
  getStatus,
  setTyping,
  clearTyping,
  getTypingUsers,
} from '../../../src/shared/realtime/presence.service';

const RUN_INTEGRATION = Boolean(process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('presence.service', () => {
  let orgId: string;
  let channelId: string;
  let userId: string;

  beforeEach(() => {
    orgId = `org:${uuidv4()}`;
    channelId = `ch:${uuidv4()}`;
    userId = `user:${uuidv4()}`;
  });

  afterEach(async () => {
    // Clean up Redis keys
    await redisClient.del(`presence:${orgId}`);
    const typingKeys = await redisClient.keys(`typing:${channelId}:*`);
    if (typingKeys.length > 0) await redisClient.del(...typingKeys);
  });

  // ── Presence ───────────────────────────────────────────────────────────────

  describe('setOnline / getStatus', () => {
    it('marks user as online', async () => {
      await setOnline(userId, orgId);
      const status = await getStatus(userId, orgId);
      expect(status).toBe('online');
    });

    it('returns offline for unknown user', async () => {
      const status = await getStatus(`unknown:${uuidv4()}`, orgId);
      expect(status).toBe('offline');
    });

    it('different users in same org are tracked independently', async () => {
      const userA = `userA:${uuidv4()}`;
      const userB = `userB:${uuidv4()}`;

      await setOnline(userA, orgId);

      expect(await getStatus(userA, orgId)).toBe('online');
      expect(await getStatus(userB, orgId)).toBe('offline');
    });
  });

  describe('setOffline', () => {
    it('removes user from presence hash', async () => {
      await setOnline(userId, orgId);
      await setOffline(userId, orgId);
      const status = await getStatus(userId, orgId);
      expect(status).toBe('offline');
    });

    it('no-ops when user is already offline', async () => {
      await expect(setOffline(userId, orgId)).resolves.not.toThrow();
      expect(await getStatus(userId, orgId)).toBe('offline');
    });
  });

  describe('heartbeat', () => {
    it('keeps user online after heartbeat', async () => {
      await setOnline(userId, orgId);
      await heartbeat(userId, orgId);
      expect(await getStatus(userId, orgId)).toBe('online');
    });

    it('heartbeat for offline user brings them online', async () => {
      // heartbeat upserts the presence record
      await heartbeat(userId, orgId);
      expect(await getStatus(userId, orgId)).toBe('online');
    });
  });

  // ── Typing indicators ──────────────────────────────────────────────────────

  describe('setTyping / clearTyping / getTypingUsers', () => {
    it('adds user to typing list', async () => {
      await setTyping(userId, channelId);
      const typing = await getTypingUsers(channelId);
      expect(typing).toContain(userId);
    });

    it('clearTyping removes user from typing list', async () => {
      await setTyping(userId, channelId);
      await clearTyping(userId, channelId);
      const typing = await getTypingUsers(channelId);
      expect(typing).not.toContain(userId);
    });

    it('returns empty array when no one is typing', async () => {
      const typing = await getTypingUsers(`ch:empty:${uuidv4()}`);
      expect(typing).toEqual([]);
    });

    it('tracks multiple users typing in same channel', async () => {
      const userA = `ua:${uuidv4()}`;
      const userB = `ub:${uuidv4()}`;

      await setTyping(userA, channelId);
      await setTyping(userB, channelId);

      const typing = await getTypingUsers(channelId);
      expect(typing).toContain(userA);
      expect(typing).toContain(userB);
    });

    it('typing indicators from different channels do not interfere', async () => {
      const channelA = `cha:${uuidv4()}`;
      const channelB = `chb:${uuidv4()}`;

      await setTyping(userId, channelA);

      const typingB = await getTypingUsers(channelB);
      expect(typingB).not.toContain(userId);

      // Cleanup
      await redisClient.del(`typing:${channelA}:${userId}`);
    });
  });
});
