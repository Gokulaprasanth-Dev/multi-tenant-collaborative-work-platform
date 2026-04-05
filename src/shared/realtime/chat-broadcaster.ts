import { Server } from 'socket.io';
import { redisPubSubClient } from '../redis/clients';
import { logger } from '../observability/logger';

const ACK_RETRIES = 3;
const ACK_RETRY_MS = 5000;

interface OutboxEvent {
  id: string;
  org_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor_user_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
}

async function emitWithAckRetry(
  io: Server,
  room: string,
  event: string,
  data: unknown,
  retries = ACK_RETRIES
): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const sockets = await io.in(room).fetchSockets();
    if (sockets.length === 0) {
      // No subscribers — nothing to retry
      return;
    }

    let acked = false;
    await new Promise<void>((resolve) => {
      let pending = sockets.length;
      for (const socket of sockets) {
        socket.emit(event, data, () => {
          acked = true;
          pending--;
          if (pending === 0) resolve();
        });
      }
      setTimeout(() => resolve(), ACK_RETRY_MS);
    });

    if (acked) return;

    if (attempt < retries) {
      logger.warn({ room, event, attempt }, 'ChatBroadcaster: ACK not received, retrying');
      await new Promise(r => setTimeout(r, ACK_RETRY_MS));
    }
  }
}

export function startChatBroadcaster(io: Server): void {
  redisPubSubClient.subscribe('outbox:events', (err) => {
    if (err) logger.error({ err }, 'ChatBroadcaster: failed to subscribe to outbox:events');
    else logger.info('ChatBroadcaster: subscribed to outbox:events');
  });

  redisPubSubClient.on('message', (_channel: string, message: string) => {
    let event: OutboxEvent;
    try {
      event = JSON.parse(message) as OutboxEvent;
    } catch {
      return;
    }

    if (event.event_type !== 'message.created' && event.event_type !== 'message.received') return;

    const channelId = event.payload['channelId'] as string | undefined;
    if (!channelId) return;

    const room = `channel:${channelId}`;
    emitWithAckRetry(io, room, event.event_type, event.payload).catch((err) => {
      logger.error({ err, room, event: event.event_type }, 'ChatBroadcaster: emit failed after retries');
    });
  });
}
