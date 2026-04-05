/**
 * EXEC-004 fix: BullMQ Worker registration separated from business logic.
 * Registers the cleanup worker with a repeatable job every 1 hour.
 */
import { Worker } from 'bullmq';
import { redisClient } from '../redis/clients';
import { queues } from '../queue/queues';
import { runCleanupJob } from './cleanup.worker';
import { logger } from '../observability/logger';

export async function startCleanupWorker(): Promise<Worker> {
  // Register repeatable job — every 1 hour
  await queues.cleanup.add(
    'run-cleanup',
    {},
    {
      repeat: { every: 60 * 60 * 1000 }, // 1 hour in ms
      jobId: 'run-cleanup-repeatable',
    }
  );

  const worker = new Worker(
    'cleanup',
    async (_job) => runCleanupJob(),
    { connection: redisClient, concurrency: 1 }
  );

  worker.on('completed', (job) => logger.debug({ jobId: job.id }, 'cleanupWorker: done'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'cleanupWorker: failed'));

  logger.info('Cleanup worker started (runs every 1 hour)');
  return worker;
}
