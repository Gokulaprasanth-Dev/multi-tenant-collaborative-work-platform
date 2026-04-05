import { Job, Worker } from 'bullmq';
import { queryPrimary } from '../../../shared/database/pool';
import { AuthRepository } from '../../auth/repositories/auth.repository';
import { persistAuditLog } from '../../audit/workers/audit.worker';
import { redisClient } from '../../../shared/redis/clients';
import { logger } from '../../../shared/observability/logger';

const authRepo = new AuthRepository();

export interface ErasureJobData {
  userId: string;
  orgId?: string;
}

export async function erasureWorkerJob(job: Job<ErasureJobData>): Promise<void> {
  const { userId } = job.data;

  // Anonymize PII
  await queryPrimary(
    `UPDATE users SET
       email = 'deleted_' || id || '@anonymised.invalid',
       name = 'Deleted User',
       phone = NULL,
       avatar_url = NULL,
       password_hash = NULL,
       totp_secret = NULL,
       totp_enabled = false,
       mfa_backup_codes = '{}',
       status = 'deleted',
       deleted_at = NOW()
     WHERE id = $1`,
    [userId]
  );

  // Revoke all active tokens
  await authRepo.revokeAllUserTokens(userId);

  // Clear user cache
  await redisClient.del(`user:cache:${userId}`);

  // Retain payment rows — do NOT delete or anonymize

  // Anonymize audit_logs.actor_id → NULL (retain rows — compliance requirement)
  // Requires UPDATE privilege on audit_logs (superuser or privileged role in production)
  try {
    await queryPrimary(
      `UPDATE audit_logs SET actor_id = NULL WHERE actor_id = $1`,
      [userId]
    );
  } catch (err) {
    logger.warn({ err, userId }, 'erasureWorker: could not anonymize audit_logs.actor_id — requires elevated privilege');
  }

  // Remove auth_providers rows
  await queryPrimary(
    `DELETE FROM auth_providers WHERE user_id = $1`,
    [userId]
  );

  // Write user.erased audit event
  await persistAuditLog({
    actorType: 'system',
    eventType: 'user.erased',
    entityType: 'user',
    entityId: userId,
    payload: { userId },
  });

  logger.info({ userId }, 'erasureWorker: user erased');
}

export function startErasureWorker(): Worker {
  const worker = new Worker<ErasureJobData>(
    'erase-user',
    erasureWorkerJob,
    { connection: redisClient, concurrency: 5 }
  );

  worker.on('completed', (job) => logger.debug({ jobId: job.id }, 'erasureWorker: done'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'erasureWorker: failed'));

  logger.info('Erasure worker started');
  return worker;
}
