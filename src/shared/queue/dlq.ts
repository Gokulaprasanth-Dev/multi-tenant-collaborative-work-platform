import { Job } from 'bullmq';
import { queues, QueueName } from './queues';

export async function getDlqJobs(queueName: QueueName): Promise<Job[]> {
  return queues[queueName].getFailed();
}

export async function requeueDlqJob(queueName: QueueName, jobId: string): Promise<void> {
  const job = await queues[queueName].getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found in queue ${queueName}`);
  await job.retry('failed');
}
