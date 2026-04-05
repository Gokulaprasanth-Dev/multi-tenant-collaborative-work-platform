import { Job } from 'bullmq';
import { NotificationRepository } from '../notification.repository';
import { getOrDefault } from '../preference.service';
import { enqueue } from '../../../shared/queue/queues';
import { logger } from '../../../shared/observability/logger';

const notifRepo = new NotificationRepository();

// Event types that trigger notification creation
const SUBSCRIBED_EVENT_TYPES = new Set([
  'task.assigned',
  'task.updated',
  'task.status_changed',
  'task.commented',
  'task.mentioned',
  'comment.created',
  'mention.created',
  'message.received',
  'message.created',
]);

export interface CreateNotificationJobData {
  eventType: string;
  orgId: string;
  entityType: string;
  entityId: string;
  actorUserId: string | null;
  targetUserIds: string[];
  payload: Record<string, unknown>;
}

function isInQuietHours(
  start: string | null,
  end: string | null,
  now: Date
): boolean {
  if (!start || !end) return false;
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH! * 60 + startM!;
  const endMinutes = endH! * 60 + endM!;

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Wraps midnight
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

export async function notificationWorkerJob(job: Job<CreateNotificationJobData>): Promise<void> {
  const { eventType, orgId, entityType, entityId, actorUserId, targetUserIds, payload } = job.data;

  if (!SUBSCRIBED_EVENT_TYPES.has(eventType)) {
    logger.debug({ eventType }, 'notificationWorker: unsubscribed event type, skipping');
    return;
  }

  const now = new Date();

  for (const userId of targetUserIds) {
    // Skip if the actor is the recipient (don't notify yourself)
    if (actorUserId && userId === actorUserId) continue;

    const pref = await getOrDefault(orgId, userId, eventType);

    // Check quiet hours
    if (isInQuietHours(pref.quiet_hours_start, pref.quiet_hours_end, now)) {
      logger.debug({ userId, eventType }, 'notificationWorker: quiet hours — skipping in-app');
      continue;
    }

    // Create in-app notification
    if (pref.channel_inapp) {
      try {
        await notifRepo.create({
          org_id: orgId,
          user_id: userId,
          type: eventType,
          entity_type: entityType,
          entity_id: entityId,
          actor_id: actorUserId,
          payload,
        });
      } catch (err) {
        logger.error({ err, userId, eventType }, 'notificationWorker: failed to create in-app notification');
      }
    }

    // Enqueue email job if enabled and not digest mode
    if (pref.channel_email && pref.digest_mode === 'realtime') {
      await enqueue('emails', 'send-notification-email', {
        orgId,
        userId,
        eventType,
        entityType,
        entityId,
        actorUserId,
        payload,
      });
    }
  }
}
