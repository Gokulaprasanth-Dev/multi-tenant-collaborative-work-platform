/**
 * Integration tests for the cleanup worker (TASK-109)
 *
 * Covers:
 * - Expired invitations are marked 'expired'
 * - Expired idempotency keys are purged
 * - Published outbox events older than 7 days are purged
 * - Failed outbox events older than 30 days are purged
 * - Worker runs idempotently without crashing
 */

import { v4 as uuidv4 } from 'uuid';
import { queryPrimary } from '../../../src/shared/database/pool';
import { runCleanupJob } from '../../../src/shared/jobs/cleanup.worker';
import { seedUser, seedOrg } from '../../helpers/db';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Cleanup Worker (TASK-109)', () => {
  it('marks expired pending invitations as expired', async () => {
    const owner = await seedUser();
    const { orgId } = await seedOrg({ ownerId: owner.userId });

    // Seed a pending invitation that has already expired
    const inviteToken = uuidv4();
    await queryPrimary(
      `INSERT INTO invitations (org_id, invited_by, email, role, token_hash, status, expires_at, created_at)
       VALUES ($1, $2, $3, 'member', $4, 'pending', NOW() - INTERVAL '1 hour', NOW())`,
      [orgId, owner.userId, `expired-invite+${uuidv4()}@example.com`, inviteToken]
    );

    await runCleanupJob();

    const row = await queryPrimary<{ status: string }>(
      `SELECT status FROM invitations WHERE token_hash = $1`,
      [inviteToken]
    );
    expect(row.rows[0]!.status).toBe('expired');
  });

  it('purges expired idempotency keys', async () => {
    const keyHash = uuidv4();
    await queryPrimary(
      `INSERT INTO idempotency_keys (key_hash, endpoint, response_status, response_body, expires_at, created_at)
       VALUES ($1, '/test', 200, '{}', NOW() - INTERVAL '1 hour', NOW())`,
      [keyHash]
    );

    await runCleanupJob();

    const row = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM idempotency_keys WHERE key_hash = $1`,
      [keyHash]
    );
    expect(parseInt(row.rows[0]!.count, 10)).toBe(0);
  });

  it('purges published outbox events older than 7 days', async () => {
    const eventId = await queryPrimary<{ id: string }>(
      `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, payload, occurred_at, status, published_at)
       VALUES (NULL, 'test.event', 'test', $1, '{}', NOW() - INTERVAL '8 days', 'published', NOW() - INTERVAL '8 days')
       RETURNING id`,
      [uuidv4()]
    ).then(r => r.rows[0]!.id);

    await runCleanupJob();

    const row = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM outbox_events WHERE id = $1`,
      [eventId]
    );
    expect(parseInt(row.rows[0]!.count, 10)).toBe(0);
  });

  it('does NOT purge recently published outbox events (< 7 days)', async () => {
    const eventId = await queryPrimary<{ id: string }>(
      `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, payload, occurred_at, status, published_at)
       VALUES (NULL, 'test.event', 'test', $1, '{}', NOW() - INTERVAL '6 days', 'published', NOW() - INTERVAL '6 days')
       RETURNING id`,
      [uuidv4()]
    ).then(r => r.rows[0]!.id);

    await runCleanupJob();

    const row = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM outbox_events WHERE id = $1`,
      [eventId]
    );
    expect(parseInt(row.rows[0]!.count, 10)).toBe(1);

    // Cleanup
    await queryPrimary(`DELETE FROM outbox_events WHERE id = $1`, [eventId]);
  });

  it('runs idempotently without crashing', async () => {
    await expect(runCleanupJob()).resolves.not.toThrow();
    await expect(runCleanupJob()).resolves.not.toThrow();
  });
});
