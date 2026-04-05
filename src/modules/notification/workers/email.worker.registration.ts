import { Worker } from 'bullmq';
import { redisClient } from '../../../shared/redis/clients';
import { emailWorkerJob, SendNotificationEmailJobData } from './email.worker';
import { logger } from '../../../shared/observability/logger';

export function startEmailWorker(): Worker {
  const worker = new Worker<SendNotificationEmailJobData>(
    'emails',
    emailWorkerJob,
    {
      connection: redisClient,
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'emailWorker: job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'emailWorker: job failed');
  });

  logger.info('Email worker started (concurrency: 5)');
  return worker;
}
