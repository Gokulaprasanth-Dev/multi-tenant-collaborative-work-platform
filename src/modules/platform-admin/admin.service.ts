import { queryPrimary, queryReplica } from '../../shared/database/pool';
import { persistAuditLog } from '../audit/workers/audit.worker';
import { enqueue, queues } from '../../shared/queue/queues';
import { registerPublicKey } from '../../shared/auth-middleware/key-store';
import { logger } from '../../shared/observability/logger';
import * as OrgService from '../organization/services/organization.service';

export interface OrgListRow extends Record<string, unknown> {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_tier: string;
  created_at: Date;
}

export async function listOrganizations(limit = 50, offset = 0): Promise<OrgListRow[]> {
  const result = await queryReplica<OrgListRow>(
    `SELECT id, name, slug, status, plan_tier, created_at FROM organizations
     WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}

export async function suspendOrg(orgId: string, reason: string, actorId: string): Promise<void> {
  await persistAuditLog({
    orgId,
    actorId,
    actorType: 'platform_admin',
    eventType: 'admin.org.suspended',
    entityType: 'org',
    entityId: orgId,
    payload: { reason },
  });
  await OrgService.suspendOrg(orgId, reason, actorId);
}

export async function reactivateOrg(orgId: string, actorId: string): Promise<void> {
  await persistAuditLog({
    orgId,
    actorId,
    actorType: 'platform_admin',
    eventType: 'admin.org.reactivated',
    entityType: 'org',
    entityId: orgId,
    payload: {},
  });
  await OrgService.reactivateOrg(orgId, actorId);
}

export async function offboardOrg(orgId: string, actorId: string): Promise<void> {
  await persistAuditLog({
    orgId,
    actorId,
    actorType: 'platform_admin',
    eventType: 'admin.org.offboard_initiated',
    entityType: 'org',
    entityId: orgId,
    payload: {},
  });
  await OrgService.startOffboarding(orgId, actorId);
}

export async function unlockUser(userId: string, actorId: string): Promise<void> {
  await persistAuditLog({
    actorId,
    actorType: 'platform_admin',
    eventType: 'admin.user.unlocked',
    entityType: 'user',
    entityId: userId,
    payload: {},
  });
  await queryPrimary(
    `UPDATE users SET locked_until = NULL, failed_login_attempts = 0 WHERE id = $1`,
    [userId]
  );
}

/**
 * resetUserMfa: clears totp_enabled, mfa_backup_codes, totp_secret
 * Documented in RUNBOOK.md under §5.5
 */
export async function resetUserMfa(userId: string, actorId: string): Promise<void> {
  await persistAuditLog({
    actorId,
    actorType: 'platform_admin',
    eventType: 'admin.user.mfa_reset',
    entityType: 'user',
    entityId: userId,
    payload: {},
  });
  await queryPrimary(
    `UPDATE users SET totp_enabled = false, mfa_backup_codes = '{}', totp_secret = NULL WHERE id = $1`,
    [userId]
  );
}

export async function triggerPaymentRecovery(orgId: string, actorId: string): Promise<void> {
  await persistAuditLog({
    orgId,
    actorId,
    actorType: 'platform_admin',
    eventType: 'admin.payment.recovery_triggered',
    entityType: 'org',
    entityId: orgId,
    payload: {},
  });
  await enqueue('payments', 'handle-payment-failure', { orgId });
}

export async function replayOutboxEvent(eventId: string, actorId: string): Promise<void> {
  await persistAuditLog({
    actorId,
    actorType: 'platform_admin',
    eventType: 'admin.outbox.event_replayed',
    entityType: 'outbox_event',
    entityId: eventId,
    payload: {},
  });
  await queryPrimary(
    `UPDATE outbox_events SET status = 'pending', published_at = NULL WHERE id = $1`,
    [eventId]
  );
}

export async function requeueDlqJobs(queueName: string, actorId: string): Promise<number> {
  await persistAuditLog({
    actorId,
    actorType: 'platform_admin',
    eventType: 'admin.dlq.requeued',
    entityType: 'queue',
    entityId: queueName,
    payload: { queueName },
  });

  const queue = queues[queueName as keyof typeof queues];
  if (!queue) throw new Error(`Unknown queue: ${queueName}`);

  const failed = await queue.getFailed();
  let count = 0;
  for (const job of failed) {
    await job.retry();
    count++;
  }
  logger.info({ queueName, count, actorId }, 'admin: DLQ jobs requeued');
  return count;
}

export async function triggerSearchReindex(orgId: string, actorId: string): Promise<void> {
  await persistAuditLog({
    orgId,
    actorId,
    actorType: 'platform_admin',
    eventType: 'admin.search.reindex_triggered',
    entityType: 'org',
    entityId: orgId,
    payload: {},
  });
  await enqueue('search', 'index-entity', { action: 'reindex', orgId, entityType: 'org' });
}

export async function rotateJwtKeys(newPublicKey: string, newKid: string, actorId: string): Promise<void> {
  await persistAuditLog({
    actorId,
    actorType: 'platform_admin',
    eventType: 'admin.jwt.key_rotated',
    entityType: 'system',
    entityId: newKid,
    payload: { kid: newKid },
  });
  registerPublicKey(newKid, newPublicKey);
  logger.info({ newKid, actorId }, 'admin: JWT key rotated');
}
