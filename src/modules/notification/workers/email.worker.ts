import { Job } from 'bullmq';
import { sendTemplateEmail } from '../email/email.service';
import { redisClient } from '../../../shared/redis/clients';
import { logger } from '../../../shared/observability/logger';

export interface SendNotificationEmailJobData {
  orgId: string;
  userId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorUserId: string | null;
  payload: Record<string, unknown>;
}

const IDEMPOTENCY_TTL = 86_400; // 24 hours

// Map event type → template name + subject
const EVENT_TEMPLATE_MAP: Record<string, { template: string; subject: string }> = {
  'task.assigned':     { template: 'task-assigned',   subject: 'A task has been assigned to you' },
  'mention.created':   { template: 'mention',          subject: 'You were mentioned' },
  'invitation.created':{ template: 'invitation',       subject: "You've been invited" },
  'org.suspended':     { template: 'org-suspended',    subject: 'Your organization has been suspended' },
};

export async function emailWorkerJob(job: Job<SendNotificationEmailJobData>): Promise<void> {
  const { userId, eventType, payload } = job.data;

  const idempotencyKey = `email:sent:${userId}:${eventType}:${job.data.entityId}`;

  // Idempotency check — skip if already sent
  const already = await redisClient.get(idempotencyKey);
  if (already) {
    logger.debug({ key: idempotencyKey }, 'emailWorker: idempotency hit — skipping');
    return;
  }

  const mapping = EVENT_TEMPLATE_MAP[eventType];
  if (!mapping) {
    logger.debug({ eventType }, 'emailWorker: no template mapping for event type, skipping');
    return;
  }

  const recipientEmail = payload['recipientEmail'] as string | undefined;
  if (!recipientEmail) {
    logger.warn({ userId, eventType }, 'emailWorker: no recipientEmail in payload, skipping');
    return;
  }

  try {
    await sendTemplateEmail(recipientEmail, mapping.subject, mapping.template, payload);
    await redisClient.set(idempotencyKey, '1', 'EX', IDEMPOTENCY_TTL);
    logger.debug({ userId, eventType, to: recipientEmail }, 'emailWorker: email sent');
  } catch (err) {
    logger.error({ err, userId, eventType }, 'emailWorker: failed to send email');
    throw err; // BullMQ will retry per job options
  }
}
