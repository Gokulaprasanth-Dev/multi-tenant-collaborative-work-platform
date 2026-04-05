/**
 * TASK-109 — Cleanup BullMQ Scheduled Jobs
 * EXEC-004 fix: plain function separated from BullMQ registration.
 *
 * Runs every 1 hour (idempotent — safe to run frequently).
 */

import { queryPrimary } from '../database/pool';
import { logger } from '../observability/logger';
import { updateSearchIndexLag } from '../../modules/search/workers/search.worker';

export async function runCleanupJob(): Promise<void> {
  logger.info('cleanupWorker: starting cleanup run');

  // 1. Expire old invitations
  try {
    const result = await queryPrimary(
      `UPDATE invitations SET status = 'expired'
       WHERE status = 'pending' AND expires_at < NOW()`
    );
    logger.debug({ rowCount: result.rowCount }, 'cleanupWorker: expired invitations');
  } catch (err) {
    logger.warn({ err }, 'cleanupWorker: failed to expire invitations');
  }

  // 2. Purge expired idempotency keys
  try {
    const result = await queryPrimary(
      `DELETE FROM idempotency_keys WHERE expires_at < NOW()`
    );
    logger.debug({ rowCount: result.rowCount }, 'cleanupWorker: purged idempotency keys');
  } catch (err) {
    logger.warn({ err }, 'cleanupWorker: failed to purge idempotency keys');
  }

  // 3. Purge published outbox events older than 7 days
  try {
    const result = await queryPrimary(
      `DELETE FROM outbox_events
       WHERE status = 'published' AND published_at < NOW() - INTERVAL '7 days'`
    );
    logger.debug({ rowCount: result.rowCount }, 'cleanupWorker: purged published outbox events');
  } catch (err) {
    logger.warn({ err }, 'cleanupWorker: failed to purge outbox events');
  }

  // 4. Purge old failed outbox events (30 days)
  try {
    const result = await queryPrimary(
      `DELETE FROM outbox_events
       WHERE status = 'failed' AND created_at < NOW() - INTERVAL '30 days'`
    );
    logger.debug({ rowCount: result.rowCount }, 'cleanupWorker: purged failed outbox events');
  } catch (err) {
    logger.warn({ err }, 'cleanupWorker: failed to purge failed outbox events');
  }

  // 5. SAML cleanup with 24h buffer (audit issue 3.5 fix)
  // 24h buffer: prevents cleanup from removing an assertion that just expired,
  // which would create a replay window during the cleanup window.
  try {
    const result = await queryPrimary(
      `DELETE FROM saml_used_assertions
       WHERE not_on_or_after < NOW() - INTERVAL '24 hours'`
    );
    logger.debug({ rowCount: result.rowCount }, 'cleanupWorker: purged expired SAML assertions');
  } catch (err) {
    logger.warn({ err }, 'cleanupWorker: failed to purge SAML assertions');
  }

  // 6. Partition management — idempotent daily (audit issue 6.2 fix)
  await createNextPartitions();

  // 7. CROSS-001 fix: Audit log partition cleanup via DROP TABLE (never DELETE)
  await dropExpiredAuditLogPartitions();

  // 8. Channel sequence cleanup (audit issue 2.3 fix)
  await dropDeletedChannelSequences();

  // 9. Update search index lag metric
  try {
    await updateSearchIndexLag();
  } catch (err) {
    logger.warn({ err }, 'cleanupWorker: failed to update search index lag');
  }

  logger.info('cleanupWorker: cleanup run complete');
}

async function createNextPartitions(): Promise<void> {
  const now = new Date();

  for (let i = 1; i <= 2; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const label = `${start.getFullYear()}_${String(start.getMonth() + 1).padStart(2, '0')}`;
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);

    try {
      // chat_messages partition
      await queryPrimary(
        `CREATE TABLE IF NOT EXISTS chat_messages_${label}
         PARTITION OF chat_messages
         FOR VALUES FROM ('${startStr}') TO ('${endStr}')`
      );
      await queryPrimary(
        `CREATE INDEX IF NOT EXISTS idx_cm_${label}_ch_seq
         ON chat_messages_${label}(channel_id, sequence_number)`
      );

      // audit_logs partition
      await queryPrimary(
        `CREATE TABLE IF NOT EXISTS audit_logs_${label}
         PARTITION OF audit_logs
         FOR VALUES FROM ('${startStr}') TO ('${endStr}')`
      );

      logger.debug({ label }, 'cleanupWorker: ensured partitions');
    } catch (err) {
      logger.warn({ err, label }, 'cleanupWorker: failed to create partition');
    }
  }
}

async function dropExpiredAuditLogPartitions(): Promise<void> {
  try {
    // Find minimum retention_audit_days across all active orgs
    const minRetResult = await queryPrimary<{ min_retention: number | null }>(
      `SELECT MIN(retention_audit_days) AS min_retention
       FROM organizations WHERE status IN ('active', 'suspended')`
    );

    const minRetentionDays = minRetResult.rows[0]?.min_retention ?? 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - minRetentionDays);

    // Find monthly partition names older than cutoff
    const year = cutoffDate.getFullYear();
    const month = cutoffDate.getMonth() + 1;

    // Drop partitions for months strictly before the cutoff month
    // Check up to 24 months back
    for (let i = 1; i <= 24; i++) {
      const d = new Date(year, month - 1 - i, 1);
      const label = `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}`;

      try {
        await queryPrimary(`DROP TABLE IF EXISTS audit_logs_${label}`);
        logger.debug({ label }, 'cleanupWorker: dropped audit_logs partition');
      } catch (err) {
        logger.warn({ err, label }, 'cleanupWorker: failed to drop audit_logs partition');
        break; // If one fails, stop — older ones are already gone
      }
    }
  } catch (err) {
    logger.warn({ err }, 'cleanupWorker: failed audit log partition cleanup');
  }
}

async function dropDeletedChannelSequences(): Promise<void> {
  try {
    const result = await queryPrimary<{ id: string }>(
      `SELECT id FROM channels WHERE deleted_at < NOW() - INTERVAL '30 days'`
    );

    for (const { id } of result.rows) {
      // Drop sequence OUTSIDE any transaction (DDL sequences)
      const seqName = `channel_seq_${id.replace(/-/g, '_')}`;
      try {
        await queryPrimary(`DROP SEQUENCE IF EXISTS ${seqName}`);
        logger.debug({ seqName }, 'cleanupWorker: dropped channel sequence');
      } catch (err) {
        logger.warn({ err, seqName }, 'cleanupWorker: failed to drop channel sequence');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'cleanupWorker: failed channel sequence cleanup');
  }
}
