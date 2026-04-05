import { Job, Worker } from 'bullmq';
import { redisClient } from '../../../shared/redis/clients';
import { config } from '../../../shared/config';
import { logger } from '../../../shared/observability/logger';
import { PostgresFtsProvider } from '../postgres-fts.provider';
import { TypesenseProvider } from '../typesense.provider';
import { ISearchProvider, SearchDocument } from '../search.interface';
import { searchIndexLagSeconds } from '../../../shared/observability/metrics';
import { queryReplica } from '../../../shared/database/pool';

const IDEMPOTENCY_TTL = 5 * 60; // 5 minutes

export interface SearchIndexJobData {
  entityType: 'task' | 'message' | 'file' | 'user';
  entityId: string;
  orgId: string;
  action: 'upsert' | 'delete';
  document?: Omit<SearchDocument, 'id' | 'org_id' | 'entity_type'>;
}

function getProvider(): ISearchProvider {
  if (config.searchProvider === 'typesense') {
    return new TypesenseProvider();
  }
  return new PostgresFtsProvider();
}

export async function updateSearchIndexLag(): Promise<void> {
  try {
    // BUG-NEW-007 fix: uses explicit IN list — not LIKE
    const result = await queryReplica<{ lag: string | null }>(`
      SELECT EXTRACT(EPOCH FROM NOW() - MIN(occurred_at)) AS lag
      FROM outbox_events
      WHERE status = 'pending'
        AND event_type IN (
          'task.created', 'task.updated', 'task.deleted',
          'message.created', 'message.deleted',
          'file.confirmed', 'file.deleted'
        )
    `);
    const lag = result.rows[0]?.lag;
    searchIndexLagSeconds.set(lag !== null && lag !== undefined ? parseFloat(lag) : 0);
  } catch (err) {
    logger.warn({ err }, 'searchWorker: failed to update search_index_lag_seconds');
  }
}

export async function searchWorkerJob(job: Job<SearchIndexJobData>): Promise<void> {
  const { entityType, entityId, orgId, action, document } = job.data;

  // Idempotency: skip if already processed recently
  const idempotencyKey = `search:indexed:${entityType}:${entityId}:${action}`;
  const alreadyProcessed = await redisClient.get(idempotencyKey);
  if (alreadyProcessed) {
    logger.debug({ idempotencyKey }, 'searchWorker: idempotency hit, skipping');
    return;
  }

  const provider = getProvider();

  if (action === 'delete') {
    await provider.deleteDocument(entityId, orgId);
  } else {
    const doc: SearchDocument = {
      id: entityId,
      org_id: orgId,
      entity_type: entityType,
      ...document,
    };
    await provider.upsertDocument(doc);
  }

  await redisClient.set(idempotencyKey, '1', 'EX', IDEMPOTENCY_TTL);

  await updateSearchIndexLag();
}

export function startSearchWorker(): Worker {
  const worker = new Worker<SearchIndexJobData>(
    'search',
    searchWorkerJob,
    { connection: redisClient, concurrency: 10 }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'searchWorker: job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'searchWorker: job failed');
  });

  logger.info('Search worker started (concurrency: 10)');
  return worker;
}
