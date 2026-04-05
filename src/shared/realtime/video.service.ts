import { Socket, Server } from 'socket.io';
import { redisClient } from '../redis/clients';
import { queryPrimary } from '../database/pool';
import { logger } from '../observability/logger';
import { isEnabled } from '../../modules/feature-flag/feature-flag.service';

const CALL_STATE_TTL = 4 * 60 * 60; // 4 hours

export interface VideoCallState {
  callId: string;
  channelId: string;
  orgId: string;
  participants: string[];
  startedAt: string;
}

export async function handleCallJoin(
  socket: Socket,
  io: Server,
  data: { callId: string; channelId: string }
): Promise<void> {
  const { callId, channelId } = data;
  const userId = socket.data.userId as string;
  const orgId = socket.data.orgId as string;

  // Feature flag: feature.video_signaling must be enabled for this org (business+ plan)
  const videoEnabled = await isEnabled(orgId, 'feature.video_signaling');
  if (!videoEnabled) {
    socket.emit('error', { code: 'FEATURE_NOT_ENABLED', message: 'Video signaling is not enabled for this organization.' });
    return;
  }

  await socket.join(`call:${callId}`);

  // Update Redis state
  const stateKey = `call:state:${callId}`;
  await redisClient.hset(stateKey, 'callId', callId, 'channelId', channelId, 'orgId', orgId);
  await redisClient.sadd(`call:participants:${callId}`, userId);
  await redisClient.expire(stateKey, CALL_STATE_TTL);
  await redisClient.expire(`call:participants:${callId}`, CALL_STATE_TTL);

  // Create/update video_calls DB row
  await queryPrimary(
    `INSERT INTO video_calls (id, channel_id, org_id, status, started_at)
     VALUES ($1, $2, $3, 'active', NOW())
     ON CONFLICT (id) DO UPDATE SET status = 'active'`,
    [callId, channelId, orgId]
  );

  io.to(`call:${callId}`).emit('call:participant-joined', { userId, callId });
  logger.debug({ callId, userId }, 'VideoService: user joined call');
}

export async function handleCallLeave(
  socket: Socket,
  io: Server,
  data: { callId: string }
): Promise<void> {
  const { callId } = data;
  const userId = socket.data.userId as string;

  await socket.leave(`call:${callId}`);
  await redisClient.srem(`call:participants:${callId}`, userId);

  // Check if call is now empty
  const count = await redisClient.scard(`call:participants:${callId}`);
  if (count === 0) {
    await queryPrimary(
      `UPDATE video_calls SET status = 'ended', ended_at = NOW() WHERE id = $1`,
      [callId]
    );
  }

  io.to(`call:${callId}`).emit('call:participant-left', { userId, callId });
  logger.debug({ callId, userId }, 'VideoService: user left call');
}

export function handleCallOffer(
  socket: Socket,
  io: Server,
  data: { callId: string; targetUserId: string; offer: unknown }
): void {
  const senderId = socket.data.userId as string;
  const orgId = socket.data.orgId as string;
  io.to(`org:${orgId}:user:${data.targetUserId}`).emit('call:offer', {
    callId: data.callId,
    senderId,
    offer: data.offer,
  });
}

export function handleCallAnswer(
  socket: Socket,
  io: Server,
  data: { callId: string; targetUserId: string; answer: unknown }
): void {
  const senderId = socket.data.userId as string;
  const orgId = socket.data.orgId as string;
  io.to(`org:${orgId}:user:${data.targetUserId}`).emit('call:answer', {
    callId: data.callId,
    senderId,
    answer: data.answer,
  });
}

export function handleIceCandidate(
  socket: Socket,
  io: Server,
  data: { callId: string; targetUserId: string; candidate: unknown }
): void {
  const senderId = socket.data.userId as string;
  const orgId = socket.data.orgId as string;
  io.to(`org:${orgId}:user:${data.targetUserId}`).emit('call:ice-candidate', {
    callId: data.callId,
    senderId,
    candidate: data.candidate,
  });
}
