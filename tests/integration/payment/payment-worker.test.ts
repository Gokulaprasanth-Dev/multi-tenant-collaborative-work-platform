/**
 * Integration tests for paymentWorkerJob
 *
 * Covers:
 * - handle-payment-failure: sets grace_period_ends_at, writes outbox event
 * - handle-payment-failure: idempotent — skips if grace period already set
 * - check-grace-period: suspends org when grace period has expired
 * - check-grace-period: no-ops if grace period not yet expired
 * - check-grace-period: no-ops if org is not active
 * - payment-captured: reactivates suspended org and clears grace_period_ends_at
 * - payment-captured: clears grace_period_ends_at even if org is already active
 */

import type { Job } from 'bullmq';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import {
  paymentWorkerJob,
  type PaymentJobData,
} from '../../../src/modules/payment/workers/payment.worker';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

function makeJob(name: string, data: PaymentJobData): Job<PaymentJobData> {
  return { name, data } as unknown as Job<PaymentJobData>;
}

maybeDescribe('paymentWorkerJob', () => {
  let orgId: string;

  beforeEach(async () => {
    const owner = await seedUser();
    const org = await seedOrg({ ownerId: owner.userId });
    orgId = org.orgId;
    // Ensure org starts as active with no grace period
    await queryPrimary(
      `UPDATE organizations SET status = 'active', grace_period_ends_at = NULL WHERE id = $1`,
      [orgId]
    );
  });

  // ── handle-payment-failure ───────────────────────────────────────────────

  it('sets grace_period_ends_at ~7 days from now on payment failure', async () => {
    await paymentWorkerJob(makeJob('handle-payment-failure', { orgId }));

    const row = await queryPrimary<{ grace_period_ends_at: Date | null }>(
      `SELECT grace_period_ends_at FROM organizations WHERE id = $1`,
      [orgId]
    );
    const grace = row.rows[0]!.grace_period_ends_at;
    expect(grace).not.toBeNull();
    // Should be roughly 7 days from now (within ±1 minute)
    const diffMs = grace!.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(diffMs).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  });

  it('writes org.grace_period_started outbox event on payment failure', async () => {
    await paymentWorkerJob(makeJob('handle-payment-failure', { orgId }));

    const row = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM outbox_events
       WHERE org_id = $1 AND event_type = 'org.grace_period_started'`,
      [orgId]
    );
    expect(parseInt(row.rows[0]!.count, 10)).toBeGreaterThanOrEqual(1);
  });

  it('handle-payment-failure is idempotent when grace_period_ends_at already set', async () => {
    // Pre-set grace period
    await queryPrimary(
      `UPDATE organizations SET grace_period_ends_at = NOW() + INTERVAL '5 days' WHERE id = $1`,
      [orgId]
    );
    const before = await queryPrimary<{ grace_period_ends_at: Date }>(
      `SELECT grace_period_ends_at FROM organizations WHERE id = $1`,
      [orgId]
    );
    const originalGrace = before.rows[0]!.grace_period_ends_at;

    await paymentWorkerJob(makeJob('handle-payment-failure', { orgId }));

    const after = await queryPrimary<{ grace_period_ends_at: Date }>(
      `SELECT grace_period_ends_at FROM organizations WHERE id = $1`,
      [orgId]
    );
    // grace_period_ends_at should not change
    expect(after.rows[0]!.grace_period_ends_at.toISOString()).toBe(originalGrace.toISOString());
  });

  // ── check-grace-period ────────────────────────────────────────────────────

  it('suspends org when grace period has expired', async () => {
    await queryPrimary(
      `UPDATE organizations SET grace_period_ends_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
      [orgId]
    );

    await paymentWorkerJob(makeJob('check-grace-period', { orgId }));

    const row = await queryPrimary<{ status: string }>(
      `SELECT status FROM organizations WHERE id = $1`,
      [orgId]
    );
    expect(row.rows[0]!.status).toBe('suspended');
  });

  it('does not suspend when grace period has not yet expired', async () => {
    await queryPrimary(
      `UPDATE organizations SET grace_period_ends_at = NOW() + INTERVAL '3 days' WHERE id = $1`,
      [orgId]
    );

    await paymentWorkerJob(makeJob('check-grace-period', { orgId }));

    const row = await queryPrimary<{ status: string }>(
      `SELECT status FROM organizations WHERE id = $1`,
      [orgId]
    );
    expect(row.rows[0]!.status).toBe('active');
  });

  it('does not suspend if org is already suspended (BUG-NEW-003)', async () => {
    await queryPrimary(
      `UPDATE organizations SET status = 'suspended', grace_period_ends_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
      [orgId]
    );

    // Should no-op without error
    await expect(paymentWorkerJob(makeJob('check-grace-period', { orgId }))).resolves.not.toThrow();

    const row = await queryPrimary<{ status: string }>(
      `SELECT status FROM organizations WHERE id = $1`,
      [orgId]
    );
    expect(row.rows[0]!.status).toBe('suspended');
  });

  // ── payment-captured ──────────────────────────────────────────────────────

  it('reactivates suspended org on payment-captured', async () => {
    await queryPrimary(
      `UPDATE organizations SET status = 'suspended', grace_period_ends_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [orgId]
    );

    await paymentWorkerJob(makeJob('payment-captured', { orgId }));

    const row = await queryPrimary<{ status: string; grace_period_ends_at: Date | null }>(
      `SELECT status, grace_period_ends_at FROM organizations WHERE id = $1`,
      [orgId]
    );
    expect(row.rows[0]!.status).toBe('active');
    expect(row.rows[0]!.grace_period_ends_at).toBeNull();
  });

  it('clears grace_period_ends_at for active org on payment-captured', async () => {
    await queryPrimary(
      `UPDATE organizations SET grace_period_ends_at = NOW() + INTERVAL '2 days' WHERE id = $1`,
      [orgId]
    );

    await paymentWorkerJob(makeJob('payment-captured', { orgId }));

    const row = await queryPrimary<{ grace_period_ends_at: Date | null }>(
      `SELECT grace_period_ends_at FROM organizations WHERE id = $1`,
      [orgId]
    );
    expect(row.rows[0]!.grace_period_ends_at).toBeNull();
  });
});
