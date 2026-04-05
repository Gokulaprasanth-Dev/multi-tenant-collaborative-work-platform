import { Worker } from 'bullmq';
import { redisClient } from '../../../shared/redis/clients';
import { notificationWorkerJob, CreateNotificationJobData } from './notification.worker';
import { logger } from '../../../shared/observability/logger';

export function startNotificationWorker(): Worker {
  const worker = new Worker<CreateNotificationJobData>(
    'notifications',
    notificationWorkerJob,
    {
      connection: redisClient,
      concurrency: 10,
    }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, name: job.name }, 'notificationWorker: job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, name: job?.name, err }, 'notificationWorker: job failed');
  });

  logger.info('Notification worker started (concurrency: 10)');
  return worker;
}
