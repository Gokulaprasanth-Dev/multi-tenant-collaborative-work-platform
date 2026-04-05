/**
 * EXEC-004 fix: BullMQ Worker registration separated from business logic.
 */
import { Worker, Job } from 'bullmq';
import { redisClient } from '../../../shared/redis/clients';
import { queues } from '../../../shared/queue/queues';
import {
  runDigestCoordinatorJob,
  runSendUserDigestJob,
  SendUserDigestJobData,
} from './digest.worker';
import { logger } from '../../../shared/observability/logger';

export async function startDigestWorker(): Promise<Worker> {
  // Register repeatable coordinator job — every 1 hour
  await queues.notifications.add(
    'digest-coordinator',
    {},
    {
      repeat: { every: 60 * 60 * 1000 }, // 1 hour
      jobId: 'digest-coordinator-repeatable',
    }
  );

  const worker = new Worker(
    'notifications',
    async (job: Job) => {
      if (job.name === 'digest-coordinator') {
        return runDigestCoordinatorJob();
      }
      if (job.name === 'send-user-digest') {
        return runSendUserDigestJob(job.data as SendUserDigestJobData);
      }
    },
    { connection: redisClient, concurrency: 10 }
  );

  worker.on('completed', (job) => logger.debug({ jobId: job.id }, 'digestWorker: done'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'digestWorker: failed'));

  logger.info('Digest worker started');
  return worker;
}
