import * as crypto from 'crypto';
import { FileRepository, FileRow } from './file.repository';
import { withTransaction } from '../../shared/database/pool';
import { S3Adapter } from '../../shared/storage/s3.adapter';
import { LocalAdapter } from '../../shared/storage/local.adapter';
import { IStorageProvider, UploadSpec } from '../../shared/storage/storage.interface';
import { config } from '../../shared/config';
import { UnprocessableError, ForbiddenError, NotFoundError } from '../../shared/errors/app-errors';

// BUG-NEW-004 fix: MIME allowlist — exact order of validation matters
const MIME_ALLOWLIST = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// Per-plan file size limits in bytes
const PLAN_MAX_FILE_BYTES: Record<string, number> = {
  free:       10 * 1024 * 1024,   // 10 MB
  pro:        100 * 1024 * 1024,  // 100 MB
  business:   500 * 1024 * 1024,  // 500 MB
  enterprise: 2 * 1024 * 1024 * 1024, // 2 GB
};

const DEFAULT_MAX_FILE_BYTES = PLAN_MAX_FILE_BYTES['free']!;

const fileRepo = new FileRepository();

function getStorageProvider(): IStorageProvider {
  if (config.storageProvider === 's3') return new S3Adapter();
  return new LocalAdapter();
}

export interface RequestUploadUrlInput {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface RequestUploadUrlResult {
  fileId: string;
  uploadUrl: string;
  uploadFields?: Record<string, string>;
  expiresAt: Date;
}

export async function requestUploadUrl(
  orgId: string,
  uploaderId: string,
  input: RequestUploadUrlInput,
  planTier = 'free'
): Promise<RequestUploadUrlResult> {
  const { filename, mimeType, sizeBytes } = input;

  // CRITICAL (BUG-NEW-004 fix): exact order matters

  // Step 1: MIME allowlist check
  if (!MIME_ALLOWLIST.includes(mimeType)) {
    throw new UnprocessableError('INVALID_MIME_TYPE', `MIME type '${mimeType}' is not allowed`);
  }

  // Step 2: Per-plan size limit check
  const maxBytes = PLAN_MAX_FILE_BYTES[planTier] ?? DEFAULT_MAX_FILE_BYTES;
  if (sizeBytes > maxBytes) {
    throw new UnprocessableError('FILE_TOO_LARGE', `File size exceeds ${maxBytes} bytes for plan '${planTier}'`);
  }

  // Step 3: Generate storageKey
  const storageKey = crypto.randomUUID();

  // Step 4: Generate presigned URL BEFORE any quota reservation
  // If this fails, no quota is touched and no DB row is created
  const storageProvider = getStorageProvider();
  const uploadSpec: UploadSpec = await storageProvider.generateUploadUrl(storageKey, mimeType, sizeBytes);

  // Step 5: Atomically reserve quota AND insert file row
  let fileRow: FileRow;
  await withTransaction(async (client) => {
    const quotaResult = await client.query(
      `UPDATE organizations
       SET storage_used_bytes = storage_used_bytes + $1
       WHERE id = $2 AND storage_used_bytes + $1 <= storage_quota_bytes
       RETURNING id`,
      [sizeBytes, orgId]
    );
    if ((quotaResult as { rows: unknown[] }).rows.length === 0) {
      throw new ForbiddenError('PLAN_STORAGE_QUOTA_EXCEEDED', 'Storage quota exceeded for this organization');
    }

    const insertResult = await client.query(
      `INSERT INTO files (org_id, uploader_id, filename, storage_key, mime_type, size_bytes, status, scan_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'pending')
       RETURNING *`,
      [orgId, uploaderId, filename, storageKey, mimeType, sizeBytes]
    );
    fileRow = (insertResult as { rows: FileRow[] }).rows[0]!;
  });

  return {
    fileId: fileRow!.id,
    uploadUrl: uploadSpec.url,
    uploadFields: uploadSpec.fields,
    expiresAt: uploadSpec.expiresAt,
  };
}

export interface DownloadUrlResult {
  url: string;
}

/**
 * CONSISTENCY-005 fix: pending scan_status returns special signal for 202 response.
 * The router is responsible for emitting the 202 with Retry-After: 30.
 */
export const SCAN_PENDING_SIGNAL = Symbol('SCAN_PENDING');

export async function generateDownloadUrl(
  orgId: string,
  fileId: string,
  _requesterId: string
): Promise<DownloadUrlResult | typeof SCAN_PENDING_SIGNAL> {
  const file = await fileRepo.findById(fileId, orgId);
  if (!file) throw new NotFoundError('File');

  if (file.status === 'quarantined') {
    throw new UnprocessableError('FILE_QUARANTINED', 'This file has been quarantined due to a virus scan failure');
  }

  if (file.scan_status === 'pending') {
    return SCAN_PENDING_SIGNAL;
  }

  const storageProvider = getStorageProvider();
  const url = await storageProvider.generateDownloadUrl(file.storage_key, 3600);
  return { url };
}

export async function getFile(orgId: string, fileId: string): Promise<FileRow> {
  const file = await fileRepo.findById(fileId, orgId);
  if (!file) throw new NotFoundError('File');
  return file;
}

export async function listFiles(orgId: string, limit: number, offset: number): Promise<FileRow[]> {
  return fileRepo.findByOrg(orgId, limit, offset);
}
