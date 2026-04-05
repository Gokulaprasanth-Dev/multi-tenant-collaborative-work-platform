/**
 * Integration tests for notificationWorkerJob (TASK-notification-worker)
 *
 * Covers:
 * - Unsubscribed event types are skipped (no notification created)
 * - Actor is not notified (self-notification skip)
 * - In-app notification created for subscribed event type with default prefs
 * - No in-app notification when channel_inapp is disabled
 * - No in-app notification during quiet hours
 * - Multiple target users: each gets their own notification
 */

import { v4 as uuidv4 } from 'uuid';
import type { Job } from 'bullmq';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import {
  notificationWorkerJob,
  type CreateNotificationJobData,
} from '../../../src/modules/notification/workers/notification.worker';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

/** Creates a minimal BullMQ Job stub — the worker only reads job.data */
function makeJob(data: CreateNotificationJobData): Job<CreateNotificationJobData> {
  return { data } as unknown as Job<CreateNotificationJobData>;
}

maybeDescribe('notificationWorkerJob', () => {
  let orgId: string;
  let actorId: string;
  let targetId: string;

  beforeEach(async () => {
    const actor = await seedUser();
    const target = await seedUser();
    const org = await seedOrg({ ownerId: actor.userId });
    orgId = org.orgId;
    actorId = actor.userId;
    targetId = target.userId;

    // Ensure target is a member of the org
    await queryPrimary(
      `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
       VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [orgId, targetId]
    );
  });

  it('skips unsubscribed event types — no notification created', async () => {
    const entityId = uuidv4();
    await notificationWorkerJob(makeJob({
      eventType: 'org.created',      // not in SUBSCRIBED_EVENT_TYPES
      orgId,
      entityType: 'org',
      entityId,
      actorUserId: actorId,
      targetUserIds: [targetId],
      payload: {},
    }));

    const row = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE org_id = $1 AND user_id = $2 AND entity_id = $3`,
      [orgId, targetId, entityId]
    );
    expect(parseInt(row.rows[0]!.count, 10)).toBe(0);
  });

  it('skips actor as recipient — no self-notification', async () => {
    const entityId = uuidv4();
    await notificationWorkerJob(makeJob({
      eventType: 'task.assigned',
      orgId,
      entityType: 'task',
      entityId,
      actorUserId: actorId,
      targetUserIds: [actorId],       // actor is the only target
      payload: {},
    }));

    const row = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE org_id = $1 AND user_id = $2 AND entity_id = $3`,
      [orgId, actorId, entityId]
    );
    expect(parseInt(row.rows[0]!.count, 10)).toBe(0);
  });

  it('creates in-app notification for subscribed event with default prefs', async () => {
    const entityId = uuidv4();
    await notificationWorkerJob(makeJob({
      eventType: 'task.assigned',
      orgId,
      entityType: 'task',
      entityId,
      actorUserId: actorId,
      targetUserIds: [targetId],
      payload: { title: 'Fix bug' },
    }));

    const row = await queryPrimary<{ type: string; actor_id: string | null }>(
      `SELECT type, actor_id FROM notifications WHERE org_id = $1 AND user_id = $2 AND entity_id = $3 LIMIT 1`,
      [orgId, targetId, entityId]
    );
    expect(row.rows[0]!.type).toBe('task.assigned');
    expect(row.rows[0]!.actor_id).toBe(actorId);
  });

  it('does NOT create in-app notification when channel_inapp is disabled', async () => {
    // Explicitly disable in-app channel for this event
    await queryPrimary(
      `INSERT INTO notification_preferences (org_id, user_id, event_type, channel_inapp, channel_email, channel_push)
       VALUES ($1, $2, 'task.commented', false, true, false)
       ON CONFLICT (org_id, user_id, event_type) DO UPDATE SET channel_inapp = false`,
      [orgId, targetId]
    );

    const entityId = uuidv4();
    await notificationWorkerJob(makeJob({
      eventType: 'task.commented',
      orgId,
      entityType: 'task',
      entityId,
      actorUserId: actorId,
      targetUserIds: [targetId],
      payload: {},
    }));

    const row = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE org_id = $1 AND user_id = $2 AND entity_id = $3`,
      [orgId, targetId, entityId]
    );
    expect(parseInt(row.rows[0]!.count, 10)).toBe(0);
  });

  it('does NOT create notification during quiet hours', async () => {
    // Set quiet hours that cover the entire day (00:00–23:59)
    await queryPrimary(
      `INSERT INTO notification_preferences
         (org_id, user_id, event_type, channel_inapp, channel_email, channel_push, quiet_hours_start, quiet_hours_end)
       VALUES ($1, $2, 'mention.created', true, true, false, '00:00', '23:59')
       ON CONFLICT (org_id, user_id, event_type) DO UPDATE
         SET quiet_hours_start = '00:00', quiet_hours_end = '23:59'`,
      [orgId, targetId]
    );

    const entityId = uuidv4();
    await notificationWorkerJob(makeJob({
      eventType: 'mention.created',
      orgId,
      entityType: 'message',
      entityId,
      actorUserId: actorId,
      targetUserIds: [targetId],
      payload: {},
    }));

    const row = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE org_id = $1 AND user_id = $2 AND entity_id = $3`,
      [orgId, targetId, entityId]
    );
    expect(parseInt(row.rows[0]!.count, 10)).toBe(0);
  });

  it('notifies all non-actor target users', async () => {
    const extra = await seedUser();
    await queryPrimary(
      `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
       VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [orgId, extra.userId]
    );

    const entityId = uuidv4();
    await notificationWorkerJob(makeJob({
      eventType: 'message.received',
      orgId,
      entityType: 'message',
      entityId,
      actorUserId: actorId,
      targetUserIds: [targetId, extra.userId, actorId],  // actorId should be skipped
      payload: {},
    }));

    const row = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE org_id = $1 AND entity_id = $2`,
      [orgId, entityId]
    );
    // targetId + extra.userId = 2; actorId skipped
    expect(parseInt(row.rows[0]!.count, 10)).toBe(2);
  });

  it('is idempotent — running twice creates two notifications per user (no dedup by design)', async () => {
    const entityId = uuidv4();
    const job = makeJob({
      eventType: 'task.mentioned',
      orgId,
      entityType: 'task',
      entityId,
      actorUserId: actorId,
      targetUserIds: [targetId],
      payload: {},
    });

    await notificationWorkerJob(job);
    await notificationWorkerJob(job);

    const row = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE org_id = $1 AND user_id = $2 AND entity_id = $3`,
      [orgId, targetId, entityId]
    );
    expect(parseInt(row.rows[0]!.count, 10)).toBe(2);
  });
});
