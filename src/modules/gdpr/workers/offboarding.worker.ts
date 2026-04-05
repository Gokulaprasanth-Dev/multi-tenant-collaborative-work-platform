/**
 * EXEC-004 fix: Logic separated from BullMQ registration.
 * `runOffboardingJob` is a plain async function importable from tests without BullMQ side effects.
 * See offboarding.worker.registration.ts for the BullMQ Worker setup.
 */

import { queryPrimary } from '../../../shared/database/pool';
import { enqueue } from '../../../shared/queue/queues';
import { persistAuditLog } from '../../audit/workers/audit.worker';
import { logger } from '../../../shared/observability/logger';

export interface OffboardingJobPayload {
  orgId: string;
}

export async function runOffboardingJob(payload: OffboardingJobPayload): Promise<void> {
  const { orgId } = payload;

  // Verify org status
  const orgResult = await queryPrimary<{ status: string }>(
    `SELECT status FROM organizations WHERE id = $1 LIMIT 1`,
    [orgId]
  );

  if (orgResult.rows.length === 0) {
    logger.warn({ orgId }, 'offboardingWorker: org not found');
    return;
  }

  const org = orgResult.rows[0]!;
  if (org.status === 'deleted') {
    logger.warn({ orgId }, 'offboardingWorker: org already deleted, skipping');
    return;
  }

  if (org.status !== 'offboarding') {
    logger.warn({ orgId, status: org.status }, 'offboardingWorker: org not in offboarding status');
    return;
  }

  // Erase all active members via erase-user jobs
  const membersResult = await queryPrimary<{ user_id: string }>(
    `SELECT user_id FROM org_memberships WHERE org_id = $1 AND status = 'active' AND deleted_at IS NULL`,
    [orgId]
  );

  for (const member of membersResult.rows) {
    await enqueue('erase-user', 'erase-user', { userId: member.user_id, orgId });
  }

  // Soft-delete all org data
  const now = new Date();
  await queryPrimary(`UPDATE workspaces SET deleted_at = $2 WHERE org_id = $1 AND deleted_at IS NULL`, [orgId, now]);
  await queryPrimary(`UPDATE tasks SET deleted_at = $2 WHERE org_id = $1 AND deleted_at IS NULL`, [orgId, now]);
  await queryPrimary(`UPDATE channels SET deleted_at = $2 WHERE org_id = $1 AND deleted_at IS NULL`, [orgId, now]);
  await queryPrimary(`UPDATE files SET deleted_at = $2, status = 'deleted' WHERE org_id = $1 AND deleted_at IS NULL`, [orgId, now]);
  await queryPrimary(`UPDATE webhook_subscriptions SET deleted_at = $2 WHERE org_id = $1 AND deleted_at IS NULL`, [orgId, now]);

  // Retain payments and subscriptions — do NOT touch payments/subscriptions tables

  // Set org status = 'deleted'
  await queryPrimary(
    `UPDATE organizations SET status = 'deleted', deleted_at = $2 WHERE id = $1`,
    [orgId, now]
  );

  // Write audit
  await persistAuditLog({
    orgId,
    actorType: 'system',
    eventType: 'org.deleted',
    entityType: 'org',
    entityId: orgId,
    payload: { orgId },
  });

  logger.info({ orgId }, 'offboardingWorker: org offboarded successfully');
}
