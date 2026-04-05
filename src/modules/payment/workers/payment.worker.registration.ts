import { Worker } from 'bullmq';
import { redisClient } from '../../../shared/redis/clients';
import { paymentWorkerJob, PaymentJobData } from './payment.worker';
import { logger } from '../../../shared/observability/logger';

export function startPaymentWorker(): Worker {
  const worker = new Worker<PaymentJobData>(
    'payments',
    paymentWorkerJob,
    {
      connection: redisClient,
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, name: job.name }, 'paymentWorker: job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, name: job?.name, err }, 'paymentWorker: job failed');
  });

  logger.info('Payment worker started (concurrency: 5)');
  return worker;
}
