/**
 * EXEC-004 fix: BullMQ Worker registration separated from business logic.
 */
import { Worker } from 'bullmq';
import { redisClient } from '../../../shared/redis/clients';
import { runRecurringTaskJob, RecurringTaskJobData } from './recurring-task.worker';
import { logger } from '../../../shared/observability/logger';

export function startRecurringTaskWorker(): Worker<RecurringTaskJobData> {
  const worker = new Worker<RecurringTaskJobData>(
    'recurring-tasks',
    (job) => runRecurringTaskJob(job.data),
    { connection: redisClient, concurrency: 5 }
  );

  worker.on('completed', (job) => logger.debug({ jobId: job.id }, 'recurringTaskWorker: done'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'recurringTaskWorker: failed'));

  logger.info('Recurring task worker started');
  return worker;
}
