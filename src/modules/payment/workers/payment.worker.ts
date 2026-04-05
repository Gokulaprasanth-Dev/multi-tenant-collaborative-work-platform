import { Job } from 'bullmq';
import { OrganizationRepository } from '../../organization/repositories/organization.repository';
import * as OrganizationService from '../../organization/services/organization.service';
import { queryPrimary } from '../../../shared/database/pool';
import { queues } from '../../../shared/queue/queues';
import { logger } from '../../../shared/observability/logger';

const orgRepo = new OrganizationRepository();

async function writeOutboxEvent(
  eventType: string,
  orgId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await queryPrimary(
    `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
     VALUES ($1, $2, 'org', $1, NULL, $3::jsonb, NOW())`,
    [orgId, eventType, JSON.stringify(payload)]
  );
}

/**
 * Handles a payment failure:
 * - Sets grace_period_ends_at = NOW() + 7 days (CRITICAL — audit issue 3.2 fix)
 * - Writes outbox org.grace_period_started
 * - Enqueues delayed check-grace-period job
 * Idempotency: if grace_period_ends_at already set or org not active, skip.
 */
async function handlePaymentFailure(orgId: string): Promise<void> {
  const org = await orgRepo.findById(orgId);
  if (!org) {
    logger.warn({ orgId }, 'handlePaymentFailure: org not found');
    return;
  }

  // Idempotency: skip if already in grace or not active
  if (org.status === 'suspended' || org.grace_period_ends_at) {
    logger.warn({ orgId, status: org.status }, 'handlePaymentFailure: idempotency check — skipping');
    return;
  }

  // CRITICAL (audit issue 3.2 fix): Explicitly set grace_period_ends_at
  // Without this write, the check-grace-period cron job NEVER fires
  const gracePeriodEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await queryPrimary(
    `UPDATE organizations SET grace_period_ends_at = NOW() + INTERVAL '7 days' WHERE id = $1 AND status = 'active'`,
    [orgId]
  );

  await writeOutboxEvent('org.grace_period_started', orgId, {
    orgId,
    grace_period_ends_at: gracePeriodEndsAt.toISOString(),
  });

  // Enqueue delayed check job
  const delay = 7 * 24 * 60 * 60 * 1000;
  await queues['payments'].add('check-grace-period', { orgId }, { delay });

  logger.info({ orgId, gracePeriodEndsAt }, 'handlePaymentFailure: grace period started');
}

/**
 * Checks if the grace period has expired, suspends the org if so.
 * BUG-NEW-003 fix: ONLY suspend if currently active.
 */
async function checkGracePeriod(orgId: string): Promise<void> {
  const org = await orgRepo.findById(orgId);
  if (!org) return;

  // BUG-NEW-003 fix: ONLY suspend if currently active
  if (org.status !== 'active') {
    logger.warn({ orgId, status: org.status }, 'check-grace-period: org not active, skipping');
    return;
  }

  if (!org.grace_period_ends_at || org.grace_period_ends_at > new Date()) {
    logger.info({ orgId }, 'check-grace-period: grace period not expired yet or payment recovered');
    return;
  }

  await OrganizationService.suspendOrg(orgId, 'Payment failure — grace period expired', undefined);
  logger.info({ orgId }, 'check-grace-period: org suspended after grace period expiry');
}

/**
 * Handles payment captured / subscription charged:
 * - Reactivates suspended org
 * - Clears grace_period_ends_at
 */
async function handlePaymentCaptured(orgId: string): Promise<void> {
  const org = await orgRepo.findById(orgId);
  if (!org) return;

  if (org.status === 'suspended') {
    await OrganizationService.reactivateOrg(orgId, undefined);
    logger.info({ orgId }, 'handlePaymentCaptured: org reactivated');
  }

  // Clear grace period regardless of previous status
  await queryPrimary(
    `UPDATE organizations SET grace_period_ends_at = NULL WHERE id = $1`,
    [orgId]
  );
}

export interface PaymentJobData {
  orgId: string;
  [key: string]: unknown;
}

export async function paymentWorkerJob(job: Job<PaymentJobData>): Promise<void> {
  const { orgId } = job.data;

  switch (job.name) {
    case 'handle-payment-failure':
      await handlePaymentFailure(orgId);
      break;
    case 'check-grace-period':
      await checkGracePeriod(orgId);
      break;
    case 'payment-captured':
      await handlePaymentCaptured(orgId);
      break;
    default:
      logger.warn({ jobName: job.name }, 'paymentWorker: unknown job name');
  }
}
