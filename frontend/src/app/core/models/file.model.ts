// frontend/src/app/core/models/file.model.ts

export type UploadState =
  | 'pending'
  | 'uploading'
  | 'scanning'
  | 'ready'
  | 'rejected'
  | 'cancelled'
  | 'error';

export interface FileUpload {
  id: string;              // client-side uuid
  file: File;
  state: UploadState;
  progress: number;        // 0–100, meaningful only in 'uploading'
  fileId?: string;         // set on 'ready'
  error?: string;          // set on 'error' | 'rejected'
  xhr?: XMLHttpRequest;    // alive only in 'uploading'; call xhr.abort() to cancel
}

export interface FileRecord {
  id: string;
  orgId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: 'pending' | 'clean' | 'quarantined';
  createdAt: string;
}

export interface FileRecordDto {
  id: string;
  org_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  scan_status: 'pending' | 'clean' | 'quarantined';
  created_at: string;
}

export function toFileRecord(dto: FileRecordDto): FileRecord {
  return {
    id:         dto.id,
    orgId:      dto.org_id,
    filename:   dto.filename,
    mimeType:   dto.mime_type,
    sizeBytes:  dto.size_bytes,
    scanStatus: dto.scan_status,
    createdAt:  dto.created_at,
  };
}

export interface UploadUrlResult {
  fileId:       string;
  uploadUrl:    string;
  uploadFields: Record<string, string>;
  expiresAt:    string;
}

export interface UploadUrlResultDto {
  fileId:        string;
  uploadUrl:     string;
  uploadFields:  Record<string, string>;
  expiresAt:     string;
}
