import { Job, Worker } from 'bullmq';
import * as stream from 'stream';
import archiver from 'archiver';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import { S3Adapter } from '../../../shared/storage/s3.adapter';
import { queryPrimary } from '../../../shared/database/pool';
import { redisClient } from '../../../shared/redis/clients';
import { config } from '../../../shared/config';
import { logger } from '../../../shared/observability/logger';

export interface OrgExportJobData {
  orgId: string;
  requestedByUserId: string;
  requestedAt: string;
}

async function* cursorPaginate<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[],
  pageSize = 100
): AsyncGenerator<T[]> {
  let offset = 0;
  while (true) {
    const result = await queryPrimary<T>(sql + ` LIMIT ${pageSize} OFFSET ${offset}`, params);
    if (result.rows.length === 0) break;
    yield result.rows;
    if (result.rows.length < pageSize) break;
    offset += pageSize;
  }
}

function createOrgEntityStream(entityType: string, orgId: string): stream.Readable {
  const readable = new stream.Readable({ read() {} });

  (async () => {
    readable.push('[');
    let first = true;

    const queryMap: Record<string, { sql: string; params: unknown[] }> = {
      workspaces: {
        sql: `SELECT id, name, created_at FROM workspaces WHERE org_id = $1 AND deleted_at IS NULL`,
        params: [orgId],
      },
      tasks: {
        sql: `SELECT id, title, status, created_at FROM tasks WHERE org_id = $1 AND deleted_at IS NULL`,
        params: [orgId],
      },
      members: {
        sql: `SELECT user_id, role, joined_at FROM org_memberships WHERE org_id = $1 AND status = 'active' AND deleted_at IS NULL`,
        params: [orgId],
      },
    };

    const query = queryMap[entityType];
    if (!query) {
      readable.push(']');
      readable.push(null);
      return;
    }

    for await (const rows of cursorPaginate(query.sql, query.params)) {
      for (const row of rows) {
        readable.push((first ? '' : ',') + JSON.stringify(row));
        first = false;
      }
    }

    readable.push(']');
    readable.push(null);
  })().catch(err => readable.destroy(err));

  return readable;
}

export async function orgExportWorkerJob(job: Job<OrgExportJobData>): Promise<void> {
  const { orgId, requestedByUserId, requestedAt } = job.data;

  if (!config.awsS3Bucket) {
    logger.warn({ orgId }, 'orgExport: S3 not configured, skipping export');
    return;
  }

  const exportKey = `gdpr-exports/org/${orgId}/${requestedAt}.zip`;
  const s3Client = new S3Client({ region: config.awsRegion ?? 'ap-south-1' });

  const archive = archiver('zip', { zlib: { level: 6 } });
  const passThrough = new stream.PassThrough();
  archive.pipe(passThrough);

  const upload = new Upload({
    client: s3Client,
    params: { Bucket: config.awsS3Bucket, Key: exportKey, Body: passThrough },
  });

  archive.append(createOrgEntityStream('workspaces', orgId), { name: 'workspaces.json' });
  archive.append(createOrgEntityStream('tasks', orgId), { name: 'tasks.json' });
  archive.append(createOrgEntityStream('members', orgId), { name: 'members.json' });

  archive.finalize();
  await upload.done();

  const storageAdapter = new S3Adapter();
  const downloadUrl = await storageAdapter.generateDownloadUrl(exportKey, 86400);

  await queryPrimary(
    `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
     VALUES ($1, 'gdpr.org_export_ready', 'org', $1, $2, $3::jsonb, NOW())`,
    [orgId, requestedByUserId, JSON.stringify({ orgId, downloadUrl, expiresIn: '24h' })]
  );

  logger.info({ orgId, exportKey }, 'orgExport: export complete');
}

export function startOrgExportWorker(): Worker {
  const worker = new Worker<OrgExportJobData>(
    'gdpr-org-export',
    orgExportWorkerJob,
    { connection: redisClient, concurrency: 2 }
  );

  worker.on('completed', (job) => logger.debug({ jobId: job.id }, 'orgExportWorker: done'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'orgExportWorker: failed'));

  logger.info('Org export worker started');
  return worker;
}
