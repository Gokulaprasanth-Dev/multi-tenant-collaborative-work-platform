/**
 * EXEC-004 fix: BullMQ Worker registration separated from business logic.
 * Import `runOffboardingJob` from offboarding.worker.ts in tests — no BullMQ side effects.
 */

import { Worker } from 'bullmq';
import { redisClient } from '../../../shared/redis/clients';
import { runOffboardingJob, OffboardingJobPayload } from './offboarding.worker';
import { logger } from '../../../shared/observability/logger';

export function startOffboardingWorker(): Worker<OffboardingJobPayload> {
  const worker = new Worker<OffboardingJobPayload>(
    'offboarding',
    (job) => runOffboardingJob(job.data),
    { connection: redisClient, concurrency: 1 }
  );

  worker.on('completed', (job) => logger.debug({ jobId: job.id }, 'offboardingWorker: done'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'offboardingWorker: failed'));

  logger.info('Offboarding worker started');
  return worker;
}
