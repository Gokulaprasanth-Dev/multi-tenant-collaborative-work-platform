import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redisAdapterPubClient, redisAdapterSubClient } from '../redis/clients';
// NOTE: redisAdapterPubClient and redisAdapterSubClient are dedicated instances
// NEVER use redisPubSubClient here — it's in subscribe mode for the outbox poller
import { config } from '../config';
import { logger } from '../observability/logger';
import { queryReplica, queryPrimary } from '../database/pool';
import { getPublicKey } from '../auth-middleware/key-store';
import jwt from 'jsonwebtoken';
import { RoomManager } from './room-manager';
import { checkRateLimit } from './rate-limiter';

interface JwtPayload {
  sub: string;
  orgId: string;
  role: string;
  isPlatformAdmin?: boolean;
  jti: string;
  exp: number;
  iat?: number;
  kid?: string;
}

function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.decode(token, { complete: true });
  const kid = (decoded?.header as { kid?: string })?.kid;
  const publicKey = getPublicKey(kid);
  return jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as JwtPayload;
}

export function createSocketServer(httpServer: any): Server {
  const io = new Server(httpServer, {
    adapter: createAdapter(redisAdapterPubClient, redisAdapterSubClient),
    cors: { origin: config.corsOrigins.split(',').map(o => o.trim()), credentials: true },
    transports: ['websocket', 'polling'],
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) { return next(new Error('auth:error — missing token')); }
    try {
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.sub;
      socket.data.orgId = payload.orgId;
      socket.data.role = payload.role;
      await socket.join(`org:${payload.orgId}`);
      await socket.join(`org:${payload.orgId}:user:${payload.sub}`);
      next();
    } catch {
      next(new Error('auth:error — invalid token'));
    }
  });

  // WebSocket session re-validation (audit issue 5.6 fix)
  io.on('connection', async (socket) => {
    const userId = socket.data.userId as string;
    const orgId = socket.data.orgId as string;
    const roomManager = new RoomManager(socket);

    // Load channel memberships and join channel rooms
    try {
      const memberships = await queryReplica<{ channel_id: string }>(
        `SELECT channel_id FROM channel_members WHERE user_id = $1 AND removed_at IS NULL`,
        [userId]
      );
      for (const row of memberships.rows) {
        await socket.join(`channel:${row.channel_id}`);
      }
    } catch (err) {
      logger.warn({ err, userId }, 'Socket: failed to load channel memberships');
    }

    const sessionCheckInterval = setInterval(async () => {
      try {
        const user = await queryReplica<{ status: string }>(
          'SELECT status FROM users WHERE id = $1', [userId]
        );
        const membership = await queryReplica<{ status: string }>(
          'SELECT status FROM org_memberships WHERE user_id = $1 AND org_id = $2 AND deleted_at IS NULL',
          [userId, orgId]
        );
        if (!user.rows[0] || user.rows[0].status !== 'active' ||
            !membership.rows[0] || membership.rows[0].status !== 'active') {
          socket.emit('session:expired');
          socket.disconnect(true);
        }
      } catch (err) {
        logger.warn({ err }, 'Socket session re-validation failed');
      }
    }, 5 * 60 * 1000); // every 5 minutes

    // ── SEC-NEW-005 fix: Rate-limited event handlers ────────────────────────

    socket.on('task:subscribe', async (data: { taskId: string }) => {
      const allowed = await checkRateLimit(`rate:task_subscribe:${socket.id}`, 20, 60);
      if (!allowed) { socket.emit('rate_limit:exceeded', { event: 'task:subscribe' }); return; }
      await roomManager.subscribeToTask(data.taskId, orgId);
    });

    socket.on('task:unsubscribe', async (data: { taskId: string }) => {
      const allowed = await checkRateLimit(`rate:task_subscribe:${socket.id}`, 20, 60);
      if (!allowed) { socket.emit('rate_limit:exceeded', { event: 'task:unsubscribe' }); return; }
      await roomManager.unsubscribeFromTask(data.taskId, orgId);
    });

    socket.on('call:join', async (data: { callId: string }) => {
      await roomManager.subscribeToCall(data.callId);
    });

    socket.on('call:leave', async (data: { callId: string }) => {
      await roomManager.unsubscribeFromCall(data.callId);
    });

    socket.on('call:ice-candidate', async (_data: unknown) => {
      // Rate limit: 100/1s per room — enforced per socket as a proxy
      const callRoom = [...socket.rooms].find(r => r.startsWith('call:'));
      const limitKey = callRoom ? `rate:ice:${callRoom}` : `rate:ice:${socket.id}`;
      const allowed = await checkRateLimit(limitKey, 100, 1);
      if (!allowed) { socket.emit('rate_limit:exceeded', { event: 'call:ice-candidate' }); return; }
      // relay handled by VideoService — no-op here
    });

    socket.on('message:send', async (_data: unknown) => {
      const allowed = await checkRateLimit(`rate:message_send:${userId}`, 60, 10);
      if (!allowed) { socket.emit('rate_limit:exceeded', { event: 'message:send' }); return; }
      // message processing handled by ChatBroadcaster
    });

    socket.on('presence:heartbeat', async (_data: unknown) => {
      const allowed = await checkRateLimit(`rate:presence_heartbeat:${socket.id}`, 1, 10);
      if (!allowed) { socket.emit('rate_limit:exceeded', { event: 'presence:heartbeat' }); return; }
    });

    socket.on('typing:start', async (data: { channelId: string }) => {
      const allowed = await checkRateLimit(`rate:typing:${data.channelId}:${userId}`, 1, 1);
      if (!allowed) { socket.emit('rate_limit:exceeded', { event: 'typing:start' }); return; }
    });

    socket.on('disconnect', async () => {
      clearInterval(sessionCheckInterval);
      // Record last_seen
      try {
        await queryPrimary(
          `UPDATE users SET last_seen_at = NOW() WHERE id = $1`,
          [userId]
        );
      } catch (err) {
        logger.warn({ err, userId }, 'Socket: failed to update last_seen_at');
      }
      // Emit presence:update to org room
      io.to(`org:${orgId}`).emit('presence:update', { userId, status: 'offline' });
    });
  });

  return io;
}

export function emitToOrg(io: Server, orgId: string, event: string, data: unknown): void {
  io.to(`org:${orgId}`).emit(event, data);
}
export function emitToUser(io: Server, orgId: string, userId: string, event: string, data: unknown): void {
  io.to(`org:${orgId}:user:${userId}`).emit(event, data);
}
export function emitToRoom(io: Server, room: string, event: string, data: unknown): void {
  io.to(room).emit(event, data);
}
