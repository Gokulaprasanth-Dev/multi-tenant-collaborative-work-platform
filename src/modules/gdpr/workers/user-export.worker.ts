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

export interface UserExportJobData {
  userId: string;
  orgId: string;
  requestedAt: string;
}

// C-08 fix: redact other users' PII in export
function _redactAuthorName(authorId: string, requestingUserId: string, name: string): string {
  return authorId === requestingUserId ? name : 'Org Member';
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

function createEntityStream(entityType: string, userId: string, orgId: string): stream.Readable {
  const readable = new stream.Readable({ read() {} });

  (async () => {
    readable.push('[');
    let first = true;

    let sql: string;
    let params: unknown[];

    switch (entityType) {
      case 'tasks':
        sql = `SELECT t.id, t.title, t.description, t.status, t.created_at
               FROM tasks t WHERE t.org_id = $1 AND t.deleted_at IS NULL
               AND EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $2)`;
        params = [orgId, userId];
        break;
      case 'comments':
        sql = `SELECT tc.id, tc.body, tc.created_at,
                      CASE WHEN tc.author_id = $2 THEN u.name ELSE 'Org Member' END AS author_name
               FROM comments tc
               JOIN users u ON u.id = tc.author_id
               WHERE tc.org_id = $1 AND tc.deleted_at IS NULL`;
        params = [orgId, userId];
        break;
      case 'messages':
        sql = `SELECT cm.id, cm.body, cm.created_at, cm.channel_id
               FROM chat_messages cm WHERE cm.org_id = $1 AND cm.sender_id = $2 AND cm.deleted_at IS NULL`;
        params = [orgId, userId];
        break;
      case 'files':
        sql = `SELECT f.id, f.filename, f.mime_type, f.size_bytes, f.created_at
               FROM files f WHERE f.org_id = $1 AND f.uploader_id = $2 AND f.deleted_at IS NULL`;
        params = [orgId, userId];
        break;
      default:
        readable.push(']');
        readable.push(null);
        return;
    }

    for await (const rows of cursorPaginate(sql, params)) {
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

export async function userExportWorkerJob(job: Job<UserExportJobData>): Promise<void> {
  const { userId, orgId, requestedAt } = job.data;

  if (!config.awsS3Bucket) {
    logger.warn({ userId }, 'userExport: S3 not configured, skipping export');
    return;
  }

  const exportKey = `gdpr-exports/${userId}/${requestedAt}.zip`;
  const s3Client = new S3Client({ region: config.awsRegion ?? 'ap-south-1' });

  // Streaming approach — never load all data into memory
  const archive = archiver('zip', { zlib: { level: 6 } });

  const passThrough = new stream.PassThrough();
  archive.pipe(passThrough);

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: config.awsS3Bucket,
      Key: exportKey,
      Body: passThrough,
    },
  });

  // Append entity streams — C-08 fix: PII redacted for other users
  archive.append(createEntityStream('tasks', userId, orgId), { name: 'tasks.json' });
  archive.append(createEntityStream('comments', userId, orgId), { name: 'comments.json' });
  archive.append(createEntityStream('messages', userId, orgId), { name: 'messages.json' });
  archive.append(createEntityStream('files', userId, orgId), { name: 'files.json' });

  archive.finalize();
  await upload.done();

  // Generate signed download URL (24h TTL)
  const storageAdapter = new S3Adapter();
  const downloadUrl = await storageAdapter.generateDownloadUrl(exportKey, 86400);

  // Write outbox event to email download link to user
  await queryPrimary(
    `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
     VALUES ($1, 'gdpr.export_ready', 'user', $2, $2, $3::jsonb, NOW())`,
    [orgId, userId, JSON.stringify({ userId, downloadUrl, expiresIn: '24h' })]
  );

  logger.info({ userId, exportKey }, 'userExport: export complete');
}

export function startUserExportWorker(): Worker {
  const worker = new Worker<UserExportJobData>(
    'gdpr-export',
    userExportWorkerJob,
    { connection: redisClient, concurrency: 2 }
  );

  worker.on('completed', (job) => logger.debug({ jobId: job.id }, 'userExportWorker: done'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'userExportWorker: failed'));

  logger.info('User export worker started');
  return worker;
}
