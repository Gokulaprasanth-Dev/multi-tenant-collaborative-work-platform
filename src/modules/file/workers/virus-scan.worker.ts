import { Job, Worker } from 'bullmq';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import NodeClam from 'clamscan';
import { fromFile as fileTypeFromFile } from 'file-type';
import { FileRepository } from '../file.repository';
import { queryPrimary } from '../../../shared/database/pool';
import { redisClient } from '../../../shared/redis/clients';
import { config } from '../../../shared/config';
import { logger } from '../../../shared/observability/logger';

// MIME types where the declared type is verified against actual file magic bytes.
// Types not in this map are allowed through (e.g. text/plain has no magic bytes).
const MIME_MAGIC_MAP: Record<string, string[]> = {
  'image/jpeg':       ['image/jpeg'],
  'image/png':        ['image/png'],
  'image/gif':        ['image/gif'],
  'image/webp':       ['image/webp'],
  'application/pdf':  ['application/pdf'],
  'application/zip':  ['application/zip'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip', // DOCX is a ZIP internally; file-type may return either
  ],
};

// DEP-002 fix: use clamscan npm package, NOT nodeclam (abandoned since 2020)

const fileRepo = new FileRepository();

export interface VirusScanJobData {
  fileId: string;
  storageKey: string;
  storageUrl?: string;
  orgId: string;
}

async function writeOutboxEvent(eventType: string, orgId: string, entityId: string, payload: Record<string, unknown>): Promise<void> {
  await queryPrimary(
    `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
     VALUES ($1, $2, 'file', $3, NULL, $4::jsonb, NOW())`,
    [orgId, eventType, entityId, JSON.stringify(payload)]
  );
}

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    const file = fs.createWriteStream(dest);
    protocol.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', reject);
  });
}

export async function virusScanWorkerJob(job: Job<VirusScanJobData>): Promise<void> {
  const { fileId, storageKey, storageUrl, orgId } = job.data;
  const tmpPath = `/tmp/${storageKey}`;

  try {
    // If virus scanning is disabled, mark as clean immediately
    if (!config.virusScanEnabled) {
      await queryPrimary(
        `UPDATE files SET scan_status = 'clean', scan_completed_at = NOW() WHERE id = $1`,
        [fileId]
      );
      logger.info({ fileId }, 'virusScan: scanning disabled, marked clean');
      return;
    }

    // Download file to tmp
    if (storageUrl) {
      await downloadFile(storageUrl, tmpPath);
    } else {
      logger.warn({ fileId, storageKey }, 'virusScan: no storageUrl provided, cannot download');
      return;
    }

    // Verify magic bytes match the declared MIME type (prevents MIME spoofing)
    const fileRow = await queryPrimary<{ mime_type: string; size_bytes: number }>(
      `SELECT mime_type, size_bytes FROM files WHERE id = $1`,
      [fileId]
    );
    const declaredMime = fileRow.rows[0]?.mime_type;
    const allowedActual = declaredMime ? MIME_MAGIC_MAP[declaredMime] : undefined;
    if (allowedActual) {
      const detected = await fileTypeFromFile(tmpPath);
      if (!detected || !allowedActual.includes(detected.mime)) {
        // Quarantine: declared MIME doesn't match actual content
        await queryPrimary(
          `UPDATE files SET scan_status = 'infected', scan_completed_at = NOW(), status = 'quarantined' WHERE id = $1`,
          [fileId]
        );
        if (fileRow.rows[0]) {
          await queryPrimary(
            `UPDATE organizations SET storage_used_bytes = GREATEST(0, storage_used_bytes - $1) WHERE id = $2`,
            [fileRow.rows[0].size_bytes, orgId]
          );
        }
        await writeOutboxEvent('file.quarantined', orgId, fileId, {
          fileId, storageKey, reason: 'mime_mismatch', declared: declaredMime, detected: detected?.mime ?? 'unknown',
        });
        logger.warn({ fileId, declaredMime, detected: detected?.mime }, 'virusScan: MIME mismatch — file quarantined');
        return;
      }
    }

    // Init ClamAV
    const clamscan = await new NodeClam().init({
      clamdscan: {
        host: config.clamavHost,
        port: config.clamavPort,
        timeout: 60000,
        active: true,
      },
      preference: 'clamdscan',
    });

    const { isInfected, viruses } = await clamscan.isInfected(tmpPath);

    if (isInfected) {
      // Mark infected + quarantined, reclaim quota, write outbox, delete from S3
      await queryPrimary(
        `UPDATE files SET scan_status = 'infected', scan_completed_at = NOW(), status = 'quarantined' WHERE id = $1`,
        [fileId]
      );

      // Reclaim quota
      const fileResult = await queryPrimary<{ size_bytes: number }>(
        `SELECT size_bytes FROM files WHERE id = $1`,
        [fileId]
      );
      if (fileResult.rows.length > 0) {
        const sizeBytes = fileResult.rows[0]!.size_bytes;
        await queryPrimary(
          `UPDATE organizations SET storage_used_bytes = GREATEST(0, storage_used_bytes - $1) WHERE id = $2`,
          [sizeBytes, orgId]
        );
      }

      await writeOutboxEvent('file.quarantined', orgId, fileId, { fileId, storageKey, viruses });
      logger.warn({ fileId, viruses }, 'virusScan: file quarantined');
    } else {
      await queryPrimary(
        `UPDATE files SET scan_status = 'clean', scan_completed_at = NOW(), status = 'confirmed' WHERE id = $1`,
        [fileId]
      );
      logger.info({ fileId }, 'virusScan: file clean');
    }
  } finally {
    // ALWAYS delete temp file
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      // ignore if already gone
    }
  }
}

// ── File Cleanup Worker (hourly) ─────────────────────────────────────────────

export async function fileCleanupWorkerJob(_job: Job): Promise<void> {
  // Find pending files older than 1 hour
  const stale = await fileRepo.findStalePending();

  for (const file of stale) {
    // Reclaim quota
    await queryPrimary(
      `UPDATE organizations SET storage_used_bytes = GREATEST(0, storage_used_bytes - $1) WHERE id = $2`,
      [file.size_bytes, file.org_id]
    );
    // Soft-delete
    await fileRepo.softDelete(file.id);
    logger.info({ fileId: file.id }, 'fileCleanup: stale pending file removed');
  }
}

export function startVirusScanWorker(): Worker {
  const worker = new Worker<VirusScanJobData>(
    'virus-scan',
    virusScanWorkerJob,
    { connection: redisClient, concurrency: 2 }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'virusScanWorker: job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'virusScanWorker: job failed');
  });

  logger.info('Virus scan worker started (concurrency: 2)');
  return worker;
}

export function startFileCleanupWorker(): Worker {
  const worker = new Worker(
    'file-cleanup',
    fileCleanupWorkerJob,
    { connection: redisClient, concurrency: 1 }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'fileCleanupWorker: job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'fileCleanupWorker: job failed');
  });

  logger.info('File cleanup worker started');
  return worker;
}
