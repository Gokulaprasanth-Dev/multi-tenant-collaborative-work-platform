import { queues, QueueName } from '../../src/shared/queue/queues';

/**
 * Wait for a job matching `jobName` in the given queue to complete.
 * Polls every 500ms up to `timeoutMs`.
 */
export async function waitForJob(
  queueName: QueueName,
  jobName: string,
  timeoutMs = 10_000
): Promise<void> {
  const queue = queues[queueName];
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const completed = await queue.getCompleted(0, 50);
    const found = completed.find(j => j.name === jobName);
    if (found) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`waitForJob: job "${jobName}" in queue "${queueName}" did not complete within ${timeoutMs}ms`);
}
