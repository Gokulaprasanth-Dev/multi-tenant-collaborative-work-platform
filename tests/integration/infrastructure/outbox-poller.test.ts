/**
 * Integration tests for the Outbox Poller (Phase 4)
 *
 * Covers:
 * - Pending outbox events are published to Redis channel
 * - After publish, event status changes to 'published'
 * - Idempotency: events are not re-published (status = published → skipped)
 * - Audit worker: persistAuditLog writes to audit_logs table
 */

import { v4 as uuidv4 } from 'uuid';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import { redisClient } from '../../../src/shared/redis/clients';
import { OutboxPoller } from '../../../src/shared/events/outbox-poller';
import { persistAuditLog } from '../../../src/modules/audit/workers/audit.worker';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Outbox Poller', () => {
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const owner = await seedUser();
    userId = owner.userId;
    const org = await seedOrg({ ownerId: owner.userId });
    orgId = org.orgId;
  });

  it('publishes pending events to Redis and marks them as published', async () => {
    // Drain any pre-existing pending events so our specific event fits in one batch
    await queryPrimary(`UPDATE outbox_events SET status = 'failed' WHERE status = 'pending'`);

    // Insert a pending outbox event with occurred_at in the past
    const eventResult = await queryPrimary<{ id: string }>(
      `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
       VALUES ($1, 'task.created', 'task', $2, $3, '{}', NOW() - INTERVAL '1 second')
       RETURNING id`,
      [orgId, uuidv4(), userId]
    );
    const eventId = eventResult.rows[0]!.id;

    // Subscribe to the outbox channel before polling
    const received: string[] = [];
    const subscriber = redisClient.duplicate();
    await subscriber.subscribe('outbox:events');
    subscriber.on('message', (_channel: string, message: string) => {
      received.push(message);
    });

    // Clear any stale distributed lock so pollCycle can acquire it
    await redisClient.del('outbox:poller:lock');

    // Directly invoke one poll cycle (bypassing the loop/timing)
    const poller = new OutboxPoller();
    await (poller as unknown as { pollCycle: (f: boolean) => Promise<boolean> }).pollCycle(false);

    await subscriber.unsubscribe('outbox:events');
    await subscriber.quit();

    // Verify the event is now marked as published in DB
    const row = await queryPrimary<{ status: string }>(
      `SELECT status FROM outbox_events WHERE id = $1`,
      [eventId]
    );
    expect(row.rows[0]!.status).toBe('published');

    // Verify the event was published to Redis
    const publishedIds = received
      .map(msg => { try { return JSON.parse(msg) as { id: string }; } catch { return null; } })
      .filter(Boolean)
      .map(e => (e as { id: string }).id);
    expect(publishedIds).toContain(eventId);
  });

  it('does not re-publish already published events', async () => {
    // Insert an already-published event
    const eventResult = await queryPrimary<{ id: string }>(
      `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id,
                                  payload, status, occurred_at, published_at)
       VALUES ($1, 'task.updated', 'task', $2, $3, '{}', 'published', NOW() - INTERVAL '1 second', NOW())
       RETURNING id`,
      [orgId, uuidv4(), userId]
    );
    const eventId = eventResult.rows[0]!.id;

    const received: string[] = [];
    const subscriber = redisClient.duplicate();
    await subscriber.subscribe('outbox:events');
    subscriber.on('message', (_channel: string, message: string) => {
      received.push(message);
    });

    // Clear any stale distributed lock
    await redisClient.del('outbox:poller:lock');

    const poller = new OutboxPoller();
    await (poller as unknown as { pollCycle: (f: boolean) => Promise<boolean> }).pollCycle(false);

    await subscriber.unsubscribe('outbox:events');
    await subscriber.quit();

    // The already-published event should NOT appear in the published messages
    const publishedIds = received
      .map(msg => { try { return JSON.parse(msg) as { id: string }; } catch { return null; } })
      .filter(Boolean)
      .map(e => (e as { id: string }).id);
    expect(publishedIds).not.toContain(eventId);
  });
});

maybeDescribe('Audit Worker', () => {
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const owner = await seedUser();
    userId = owner.userId;
    const org = await seedOrg({ ownerId: owner.userId });
    orgId = org.orgId;
  });

  it('persistAuditLog writes a row to audit_logs', async () => {
    const entityId = uuidv4();

    await persistAuditLog({
      orgId,
      actorId: userId,
      actorType: 'user',
      eventType: 'task.deleted',
      entityType: 'task',
      entityId,
      payload: { test: true },
    });

    const row = await queryPrimary<{ event_type: string; entity_id: string }>(
      `SELECT event_type, entity_id FROM audit_logs WHERE entity_id = $1`,
      [entityId]
    );

    expect(row.rows.length).toBe(1);
    expect(row.rows[0]!.event_type).toBe('task.deleted');
    expect(row.rows[0]!.entity_id).toBe(entityId);
  });

  it('works without optional fields (system actor)', async () => {
    await expect(persistAuditLog({
      actorType: 'system',
      eventType: 'cron.triggered',
    })).resolves.not.toThrow();
  });
});
