import { Queue, JobsOptions } from 'bullmq';
import { redisClient } from '../redis/clients';
import { context, propagation } from '@opentelemetry/api';

const connection = redisClient;

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 100,
  removeOnFail: 1000,
};

function makeQueue(name: string): Queue {
  return new Queue(name, { connection, defaultJobOptions });
}

export const queues = {
  notifications:    makeQueue('notifications'),
  emails:           makeQueue('emails'),
  webhooks:         makeQueue('webhooks'),
  search:           makeQueue('search'),
  audit:            makeQueue('audit'),
  cleanup:          makeQueue('cleanup'),
  exports:          makeQueue('exports'),
  payments:         makeQueue('payments'),
  'recurring-tasks': makeQueue('recurring-tasks'),
  'virus-scan':     makeQueue('virus-scan'),
  'erase-user':     makeQueue('erase-user'),
  'offboarding':    makeQueue('offboarding'),
  'gdpr-export':    makeQueue('gdpr-export'),
  'gdpr-org-export': makeQueue('gdpr-org-export'),
} as const;

export type QueueName = keyof typeof queues;

export async function enqueue(
  queueName: QueueName,
  jobName: string,
  data: Record<string, unknown>,
  options?: JobsOptions,
): Promise<void> {
  // Inject trace context so the worker can restore the span
  const traceCarrier: Record<string, string> = {};
  propagation.inject(context.active(), traceCarrier);
  await queues[queueName].add(jobName, { ...data, _traceContext: traceCarrier }, options);
}
