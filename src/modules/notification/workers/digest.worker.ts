/**
 * TASK-110 — Daily Digest Scheduler
 * EXEC-004 fix: plain functions separated from BullMQ registration.
 *
 * Coordinator runs every hour.
 * For each user whose timezone-local time is 08:00 ±30 min with digest_mode = 'daily_digest':
 *   enqueue send-user-digest job.
 */

import { queryPrimary, queryReplica } from '../../../shared/database/pool';
import { redisClient } from '../../../shared/redis/clients';
import { enqueue } from '../../../shared/queue/queues';
import { renderTemplate } from '../email/template.renderer';
import { logger } from '../../../shared/observability/logger';

export async function runDigestCoordinatorJob(): Promise<void> {
  const _now = new Date();

  // Find users whose timezone-local time is 08:00 ±30 min with daily_digest mode
  // We use AT TIME ZONE to convert NOW() to the user's timezone and check the hour
  const usersResult = await queryReplica<{ id: string; email: string; name: string; timezone: string }>(
    `SELECT u.id, u.email, u.name, COALESCE(u.timezone, 'UTC') AS timezone
     FROM users u
     JOIN notification_preferences np ON np.user_id = u.id
     WHERE u.status = 'active'
       AND u.deleted_at IS NULL
       AND np.digest_mode = 'daily_digest'
       AND EXTRACT(HOUR FROM NOW() AT TIME ZONE COALESCE(u.timezone, 'UTC')) = 8
       AND EXTRACT(MINUTE FROM NOW() AT TIME ZONE COALESCE(u.timezone, 'UTC')) BETWEEN 0 AND 59`
  );

  logger.info({ count: usersResult.rows.length }, 'digestCoordinator: enqueuing digest jobs');

  for (const user of usersResult.rows) {
    await enqueue('notifications', 'send-user-digest', {
      userId: user.id,
      email: user.email,
      name: user.name,
    });
  }
}

export interface SendUserDigestJobData {
  userId: string;
  email: string;
  name: string;
}

export async function runSendUserDigestJob(data: SendUserDigestJobData): Promise<void> {
  const { userId, email, name } = data;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const idempotencyKey = `digest:${userId}:${today}`;

  // Idempotency: skip if already sent today
  const already = await redisClient.get(idempotencyKey);
  if (already) {
    logger.debug({ userId, today }, 'digestWorker: already sent today, skipping');
    return;
  }

  // Load pending digest notifications (last 24h)
  const notifResult = await queryPrimary<{
    id: string;
    type: string;
    entity_type: string;
    entity_id: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>(
    `SELECT id, type, entity_type, entity_id, payload, created_at
     FROM notifications
     WHERE user_id = $1
       AND created_at > NOW() - INTERVAL '24 hours'
       AND digest_sent_at IS NULL
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId]
  );

  if (notifResult.rows.length === 0) {
    logger.debug({ userId }, 'digestWorker: no pending notifications, skipping');
    // Set idempotency key anyway to prevent re-check within same day
    await redisClient.set(idempotencyKey, '1', 'EX', 24 * 60 * 60);
    return;
  }

  // Render daily-digest template
  const html = await renderTemplate('daily-digest', {
    name,
    notifications: notifResult.rows,
    date: today,
  });

  // Enqueue email
  await enqueue('emails', 'send-daily-digest', {
    to: email,
    subject: `Your daily digest — ${today}`,
    html,
    userId,
  });

  // Mark notifications as digest-sent
  const notifIds = notifResult.rows.map(n => n.id);
  await queryPrimary(
    `UPDATE notifications SET digest_sent_at = NOW()
     WHERE id = ANY($1::uuid[])`,
    [notifIds]
  );

  // Set idempotency key (24h TTL)
  await redisClient.set(idempotencyKey, '1', 'EX', 24 * 60 * 60);

  logger.info({ userId, count: notifResult.rows.length }, 'digestWorker: digest sent');
}
