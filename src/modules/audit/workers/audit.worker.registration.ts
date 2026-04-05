import { Worker } from 'bullmq';
import { redisClient } from '../../../shared/redis/clients';
import { auditWorkerJob } from './audit.worker';

const auditWorker = new Worker('audit', auditWorkerJob, {
  connection: redisClient,
  concurrency: 5,
});

export default auditWorker;
