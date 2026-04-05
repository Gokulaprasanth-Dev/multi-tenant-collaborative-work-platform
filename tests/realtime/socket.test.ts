/**
 * Socket.IO Integration Tests (TASK-079)
 * Requires live PostgreSQL and Redis, and a running HTTP server with Socket.IO.
 */

import { io as ioClient } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import { httpServer, io } from '../../src/app';
import { seedUser, seedOrg } from '../helpers/db';
import { generateAccessToken } from '../../src/modules/auth/utils/token';
import { queryPrimary } from '../../src/shared/database/pool';
import { redisClient } from '../../src/shared/redis/clients';
import { startChatBroadcaster } from '../../src/shared/realtime/chat-broadcaster';
import { registerReconnectHandlers } from '../../src/shared/realtime/reconnect.handler';
// NOTE: app.ts already attaches Socket.IO to httpServer via createSocketServer(httpServer).
// Do NOT call createSocketServer again here — it would attach a second handler to the same
// httpServer and cause "server.handleUpgrade() was called more than once" errors.

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

const TEST_PORT = 4001;

/** Small delay to allow the server to process one socket event before sending the next */
function wait(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

maybeDescribe('Socket.IO Integration', () => {
  let serverUrl: string;

  beforeAll(async () => {
    // Socket.IO is already attached to httpServer by app.ts — just start listening
    await new Promise<void>((resolve) => {
      httpServer.listen(TEST_PORT, () => {
        serverUrl = `http://localhost:${TEST_PORT}`;
        resolve();
      });
    });

    // Wire reconnect handlers (client:sync, auth:refresh) for all new socket connections.
    // These are not registered in socket-server.ts so we add them here for integration tests.
    io.on('connection', (socket) => {
      registerReconnectHandlers(socket);
    });

    // Start ChatBroadcaster so message.created events are relayed from Redis to channel rooms.
    startChatBroadcaster(io);
    // Give ioredis time to complete the SUBSCRIBE handshake before tests run
    await new Promise<void>((r) => setTimeout(r, 500));
  });

  afterAll((done) => {
    // Force-close the HTTP server; socket.io Redis adapter connections are
    // managed separately and don't block server.close().
    httpServer.close(() => done());
    // Give any lingering socket connections 500ms to disconnect
    setTimeout(() => done(), 500);
  }, 5000);

  // ── Auth tests ─────────────────────────────────────────────────────────────

  it('rejects connection with missing token', (done) => {
    const client = ioClient(serverUrl, {
      auth: {},
      transports: ['websocket'],
      reconnection: false,
    });

    client.on('connect_error', (err) => {
      expect(err.message).toContain('auth:error');
      client.close();
      done();
    });

    client.on('connect', () => {
      client.close();
      done(new Error('Should not connect without token'));
    });
  });

  it('rejects connection with invalid token', (done) => {
    const client = ioClient(serverUrl, {
      auth: { token: 'invalid.jwt.token' },
      transports: ['websocket'],
      reconnection: false,
    });

    client.on('connect_error', (err) => {
      expect(err.message).toContain('auth:error');
      client.close();
      done();
    });

    client.on('connect', () => {
      client.close();
      done(new Error('Should not connect with invalid token'));
    });
  });

  // ── Rate limiting ──────────────────────────────────────────────────────────

  it('rate-limits task:subscribe to 20/60s per client', async () => {
    const user = await seedUser();
    const org = await seedOrg({ ownerId: user.userId });
    const token = generateAccessToken({
      sub: user.userId, orgId: org.orgId, role: 'org_owner', isPlatformAdmin: false,
    });

    const client = ioClient(serverUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('rate_limit:exceeded not received for task:subscribe')),
          15000,
        );

        client.on('connect_error', (err) => { clearTimeout(timeout); reject(err); });

        client.on('connect', async () => {
          // Wait for the server-side async connection handler to finish registering
          // event listeners (it awaits a DB query for channel memberships before
          // calling socket.on('task:subscribe', ...)). Events sent before that
          // registration completes are silently dropped.
          await wait(300);

          client.once('rate_limit:exceeded', (data: { event: string }) => {
            clearTimeout(timeout);
            expect(data.event).toBe('task:subscribe');
            resolve();
          });

          // Send 22 events with 10ms gaps — the 21st exceeds the 20/60s limit.
          // (One extra event is sent as a safety margin for any last-ms race.)
          for (let i = 0; i < 22; i++) {
            client.emit('task:subscribe', { taskId: `task-rate-${uuidv4()}` });
            await wait(10);
          }
        });
      });
    } finally {
      client.close();
    }
  }, 20000);

  // ── Presence lifecycle ─────────────────────────────────────────────────────

  it('presence:update emitted to org room on disconnect', async () => {
    const [userA, userB] = await Promise.all([seedUser(), seedUser()]);
    const org = await seedOrg({ ownerId: userA.userId });

    // Add userB to the same org
    await queryPrimary(
      `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
       VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [org.orgId, userB.userId]
    );

    const tokenA = generateAccessToken({ sub: userA.userId, orgId: org.orgId, role: 'org_owner', isPlatformAdmin: false });
    const tokenB = generateAccessToken({ sub: userB.userId, orgId: org.orgId, role: 'member', isPlatformAdmin: false });

    const opts = { transports: ['websocket'] as ['websocket'], reconnection: false };
    const clientA = ioClient(serverUrl, { ...opts, auth: { token: tokenA } });
    const clientB = ioClient(serverUrl, { ...opts, auth: { token: tokenB } });

    await new Promise<void>((resolve, reject) => {
      let aConnected = false;
      let bConnected = false;
      let settled = false;

      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        clientA.close();
        clientB.close();
        err ? reject(err) : resolve();
      };

      const timeout = setTimeout(() => settle(new Error('presence:update not received')), 5000);
      clientA.on('connect_error', (e) => { clearTimeout(timeout); settle(e); });
      clientB.on('connect_error', (e) => { clearTimeout(timeout); settle(e); });

      function onBothConnected() {
        clientB.on('presence:update', (data: { userId: string; status: string }) => {
          if (data.userId === userA.userId && data.status === 'offline') {
            clearTimeout(timeout);
            settle();
          }
        });
        // Brief delay so the Redis adapter finishes syncing room membership
        // before clientA disconnects
        setTimeout(() => clientA.close(), 200);
      }

      clientA.on('connect', () => { aConnected = true; if (bConnected) onBothConnected(); });
      clientB.on('connect', () => { bConnected = true; if (aConnected) onBothConnected(); });
    });
  }, 10000);

  it('rate-limits call:ice-candidate to 100/1s — 101st dropped', async () => {
    const user = await seedUser();
    const org = await seedOrg({ ownerId: user.userId });
    const token = generateAccessToken({
      sub: user.userId, orgId: org.orgId, role: 'org_owner', isPlatformAdmin: false,
    });

    const client = ioClient(serverUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('rate_limit:exceeded not received for call:ice-candidate')),
          15000,
        );

        client.on('connect_error', (err) => { clearTimeout(timeout); reject(err); });

        client.on('connect', async () => {
          // Wait for server-side async connection handler to finish registering listeners
          await wait(300);

          client.once('rate_limit:exceeded', (data: { event: string }) => {
            clearTimeout(timeout);
            expect(data.event).toBe('call:ice-candidate');
            resolve();
          });

          // Send 102 events synchronously (no delay) — all land within the same
          // millisecond window, well inside the 1-second sliding window.
          // The call:ice-candidate handler has no room-joining side effects,
          // so concurrent ioredis pipelines serialize correctly in Redis and the
          // ZCARD accumulates to 102 > 100, triggering rate_limit:exceeded.
          for (let i = 0; i < 102; i++) {
            client.emit('call:ice-candidate', { candidate: `candidate-${i}` });
          }
        });
      });
    } finally {
      client.close();
    }
  }, 20000);

  it('ChatBroadcaster retries message:created on missing ACK', async () => {
    const user = await seedUser();
    const org = await seedOrg({ ownerId: user.userId });
    const token = generateAccessToken({
      sub: user.userId, orgId: org.orgId, role: 'org_owner', isPlatformAdmin: false,
    });

    // Create a channel and add the user so the socket auto-joins the channel room on connect
    const channelResult = await queryPrimary<{ id: string }>(
      `INSERT INTO channels (org_id, type, name, created_by) VALUES ($1, 'group', $2, $3) RETURNING id`,
      [org.orgId, `broadcast-test-${uuidv4().slice(0, 8)}`, user.userId],
    );
    const channelId = channelResult.rows[0]!.id;

    await queryPrimary(
      `INSERT INTO channel_members (channel_id, user_id, org_id, last_read_sequence, joined_at)
       VALUES ($1, $2, $3, 0, NOW())
       ON CONFLICT DO NOTHING`,
      [channelId, user.userId, org.orgId],
    );

    const client = ioClient(serverUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        // ACK_RETRY_MS=5000, need first emit (5s wait) + retry delay (5s) + second emit ≈ 12s minimum
        const timeout = setTimeout(
          () => reject(new Error('ChatBroadcaster did not retry — received fewer than 2 message.created events')),
          20000,
        );

        let receiptCount = 0;

        client.on('connect_error', (err) => { clearTimeout(timeout); reject(err); });

        client.on('connect', async () => {
          // Wait for channel room subscription to be applied on the server
          await wait(300);

          // Receive WITHOUT calling the ack callback so the broadcaster retries
          client.on('message.created', (_data: unknown) => {
            receiptCount++;
            if (receiptCount >= 2) {
              // Received the initial emit plus at least one retry — retry logic confirmed
              clearTimeout(timeout);
              resolve();
            }
          });

          // Publish an outbox event via the general-purpose redis client (not subscribe-mode client)
          const outboxEvent = {
            id: uuidv4(),
            org_id: org.orgId,
            event_type: 'message.created',
            entity_type: 'message',
            entity_id: uuidv4(),
            actor_user_id: user.userId,
            payload: { channelId, body: 'retry test message' },
            occurred_at: new Date().toISOString(),
          };
          await redisClient.publish('outbox:events', JSON.stringify(outboxEvent));
        });
      });
    } finally {
      client.close();
    }
  }, 25000);

  it('client:sync emits missed messages for given channel sequence', async () => {
    const user = await seedUser();
    const org = await seedOrg({ ownerId: user.userId });
    const token = generateAccessToken({
      sub: user.userId, orgId: org.orgId, role: 'org_owner', isPlatformAdmin: false,
    });

    // Create channel + membership
    const channelResult = await queryPrimary<{ id: string }>(
      `INSERT INTO channels (org_id, type, name, created_by) VALUES ($1, 'group', $2, $3) RETURNING id`,
      [org.orgId, `sync-test-${uuidv4().slice(0, 8)}`, user.userId],
    );
    const channelId = channelResult.rows[0]!.id;

    await queryPrimary(
      `INSERT INTO channel_members (channel_id, user_id, org_id, last_read_sequence, joined_at)
       VALUES ($1, $2, $3, 0, NOW())
       ON CONFLICT DO NOTHING`,
      [channelId, user.userId, org.orgId],
    );

    // Seed two messages with sequence_number 1 and 2
    for (const seq of [1, 2]) {
      await queryPrimary(
        `INSERT INTO chat_messages
           (id, org_id, channel_id, sender_id, client_message_id, sequence_number, body, body_parsed, parent_message_id, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NULL, NULL, NOW())`,
        [org.orgId, channelId, user.userId, uuidv4(), seq, `Message ${seq}`],
      );
    }

    const client = ioClient(serverUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('client:sync:messages not received')),
          8000,
        );

        client.on('connect_error', (err) => { clearTimeout(timeout); reject(err); });

        client.on('connect', async () => {
          // Wait briefly for server-side channel membership load
          await wait(200);

          client.once('client:sync:messages', (data: { channelId: string; messages: unknown[] }) => {
            clearTimeout(timeout);
            try {
              expect(data.channelId).toBe(channelId);
              // Both messages after sequence 0 should be returned
              expect(data.messages.length).toBe(2);
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          });

          // Request missed messages since sequence 0 (should return messages 1 and 2)
          client.emit('client:sync', { lastMessageSequences: { [channelId]: '0' } });
        });
      });
    } finally {
      client.close();
    }
  }, 15000);
});
