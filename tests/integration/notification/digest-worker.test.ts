/**
 * Integration tests for runSendUserDigestJob (TASK-110)
 *
 * Covers:
 * - Skips when no pending notifications exist (no digest_sent_at IS NULL)
 * - Marks notifications as digest_sent_at when digest is sent
 * - Idempotent: running twice in same day does not re-process notifications
 * - Sets Redis idempotency key after first run
 */

import { v4 as uuidv4 } from 'uuid';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import { redisClient } from '../../../src/shared/redis/clients';
import { runSendUserDigestJob } from '../../../src/modules/notification/workers/digest.worker';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('runSendUserDigestJob (TASK-110)', () => {
  let orgId: string;
  let userId: string;
  let userEmail: string;

  beforeEach(async () => {
    const owner = await seedUser();
    userId = owner.userId;
    userEmail = owner.email;
    const org = await seedOrg({ ownerId: owner.userId });
    orgId = org.orgId;

    // Clear any existing Redis idempotency key for this user/date
    const today = new Date().toISOString().slice(0, 10);
    await redisClient.del(`digest:${userId}:${today}`);
  });

  afterEach(async () => {
    // Clean up Redis key
    const today = new Date().toISOString().slice(0, 10);
    await redisClient.del(`digest:${userId}:${today}`);
  });

  it('skips and sets idempotency key when no pending notifications exist', async () => {
    await runSendUserDigestJob({ userId, email: userEmail, name: 'Test User' });

    // Idempotency key should be set even when skipped (no notifications)
    const today = new Date().toISOString().slice(0, 10);
    const key = await redisClient.get(`digest:${userId}:${today}`);
    expect(key).toBe('1');
  });

  it('marks pending notifications as digest_sent_at after sending', async () => {
    // Seed a notification without digest_sent_at
    const entityId = uuidv4();
    await queryPrimary(
      `INSERT INTO notifications (org_id, user_id, type, entity_type, entity_id, actor_id, payload, created_at)
       VALUES ($1, $2, 'task.assigned', 'task', $3, NULL, '{}', NOW() - INTERVAL '1 hour')`,
      [orgId, userId, entityId]
    );

    await runSendUserDigestJob({ userId, email: userEmail, name: 'Test User' });

    const row = await queryPrimary<{ digest_sent_at: Date | null }>(
      `SELECT digest_sent_at FROM notifications WHERE entity_id = $1 AND user_id = $2`,
      [entityId, userId]
    );
    expect(row.rows[0]!.digest_sent_at).not.toBeNull();
  });

  it('does not re-process notifications on second run (idempotency via Redis)', async () => {
    const entityId = uuidv4();
    await queryPrimary(
      `INSERT INTO notifications (org_id, user_id, type, entity_type, entity_id, actor_id, payload, created_at)
       VALUES ($1, $2, 'task.mentioned', 'task', $3, NULL, '{}', NOW() - INTERVAL '30 minutes')`,
      [orgId, userId, entityId]
    );

    // First run: processes notifications
    await runSendUserDigestJob({ userId, email: userEmail, name: 'Test User' });

    // Reset digest_sent_at to simulate what would happen if run again
    // (the Redis key blocks the second run — notifications should not be touched again)
    await queryPrimary(
      `UPDATE notifications SET digest_sent_at = NULL WHERE entity_id = $1`,
      [entityId]
    );

    // Second run: blocked by Redis key
    await runSendUserDigestJob({ userId, email: userEmail, name: 'Test User' });

    // digest_sent_at should still be NULL — second run was blocked
    const row = await queryPrimary<{ digest_sent_at: Date | null }>(
      `SELECT digest_sent_at FROM notifications WHERE entity_id = $1 AND user_id = $2`,
      [entityId, userId]
    );
    expect(row.rows[0]!.digest_sent_at).toBeNull();
  });

  it('does not include notifications older than 24 hours', async () => {
    const entityId = uuidv4();
    await queryPrimary(
      `INSERT INTO notifications (org_id, user_id, type, entity_type, entity_id, actor_id, payload, created_at)
       VALUES ($1, $2, 'task.commented', 'task', $3, NULL, '{}', NOW() - INTERVAL '25 hours')`,
      [orgId, userId, entityId]
    );

    await runSendUserDigestJob({ userId, email: userEmail, name: 'Test User' });

    // Old notification should not have digest_sent_at set
    const row = await queryPrimary<{ digest_sent_at: Date | null }>(
      `SELECT digest_sent_at FROM notifications WHERE entity_id = $1 AND user_id = $2`,
      [entityId, userId]
    );
    expect(row.rows[0]!.digest_sent_at).toBeNull();
  });
});
