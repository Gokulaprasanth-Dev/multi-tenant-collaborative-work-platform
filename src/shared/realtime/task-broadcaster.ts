import { Server } from 'socket.io';
import { redisPubSubClient } from '../redis/clients';
import { logger } from '../observability/logger';
import { emitToOrg, emitToRoom, emitToUser } from './socket-server';

const TASK_EVENTS = new Set([
  'task.created',
  'task.updated',
  'task.deleted',
  'task.status_changed',
  'task.assigned',
  'task.commented',
  'task.mentioned',
  'comment.created',
  'mention.created',
]);

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

export function startTaskBroadcaster(io: Server): void {
  redisPubSubClient.subscribe('outbox:events', (err) => {
    if (err) logger.error({ err }, 'TaskBroadcaster: failed to subscribe to outbox:events');
    else logger.info('TaskBroadcaster: subscribed to outbox:events');
  });

  redisPubSubClient.on('message', (_channel: string, message: string) => {
    let event: OutboxEvent;
    try {
      event = JSON.parse(message) as OutboxEvent;
    } catch {
      return;
    }

    if (!TASK_EVENTS.has(event.event_type)) return;

    const orgId = event.org_id;
    const entityId = event.entity_id;

    switch (event.event_type) {
      case 'task.created':
      case 'task.updated':
      case 'task.deleted':
      case 'task.status_changed':
        // Emit to task room + org room
        emitToRoom(io, `org:${orgId}:task:${entityId}`, event.event_type, event.payload);
        emitToOrg(io, orgId, event.event_type, event.payload);
        break;

      case 'task.assigned':
        if (event.payload['assigneeId']) {
          emitToUser(io, orgId, event.payload['assigneeId'] as string, event.event_type, event.payload);
        }
        emitToRoom(io, `org:${orgId}:task:${entityId}`, event.event_type, event.payload);
        break;

      case 'task.commented':
      case 'comment.created':
        emitToRoom(io, `org:${orgId}:task:${entityId}`, event.event_type, event.payload);
        break;

      case 'task.mentioned':
      case 'mention.created':
        if (event.payload['mentionedUserId']) {
          emitToUser(io, orgId, event.payload['mentionedUserId'] as string, event.event_type, event.payload);
        }
        break;

      default:
        break;
    }
  });
}
