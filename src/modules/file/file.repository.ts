import { queryPrimary, queryReplica } from '../../shared/database/pool';

export interface FileRow extends Record<string, unknown> {
  id: string;
  org_id: string;
  uploader_id: string;
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  status: 'pending' | 'confirmed' | 'quarantined' | 'deleted';
  scan_status: 'pending' | 'clean' | 'infected';
  scan_completed_at: Date | null;
  created_at: Date;
  deleted_at: Date | null;
}

export class FileRepository {
  async create(data: {
    org_id: string;
    uploader_id: string;
    filename: string;
    storage_key: string;
    mime_type: string;
    size_bytes: number;
  }, client?: { query: Function }): Promise<FileRow> {
    const result = await (client
      ? client.query(
          `INSERT INTO files (org_id, uploader_id, filename, storage_key, mime_type, size_bytes, status, scan_status)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'pending')
           RETURNING *`,
          [data.org_id, data.uploader_id, data.filename, data.storage_key, data.mime_type, data.size_bytes]
        )
      : queryPrimary(
          `INSERT INTO files (org_id, uploader_id, filename, storage_key, mime_type, size_bytes, status, scan_status)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'pending')
           RETURNING *`,
          [data.org_id, data.uploader_id, data.filename, data.storage_key, data.mime_type, data.size_bytes]
        ));
    return (result as { rows: FileRow[] }).rows[0]!;
  }

  async findById(id: string, orgId: string): Promise<FileRow | null> {
    const result = await queryPrimary<FileRow>(
      `SELECT * FROM files WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [id, orgId]
    );
    return result.rows[0] ?? null;
  }

  async findByOrg(orgId: string, limit: number, offset: number): Promise<FileRow[]> {
    const result = await queryReplica<FileRow>(
      `SELECT * FROM files WHERE org_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [orgId, limit, offset]
    );
    return result.rows;
  }

  async updateScanStatus(
    id: string,
    scanStatus: 'clean' | 'infected',
    status?: 'confirmed' | 'quarantined'
  ): Promise<void> {
    if (status) {
      await queryPrimary(
        `UPDATE files SET scan_status = $2, scan_completed_at = NOW(), status = $3 WHERE id = $1`,
        [id, scanStatus, status]
      );
    } else {
      await queryPrimary(
        `UPDATE files SET scan_status = $2, scan_completed_at = NOW() WHERE id = $1`,
        [id, scanStatus]
      );
    }
  }

  async softDelete(id: string): Promise<void> {
    await queryPrimary(
      `UPDATE files SET deleted_at = NOW(), status = 'deleted' WHERE id = $1`,
      [id]
    );
  }

  async findStalePending(): Promise<FileRow[]> {
    const result = await queryPrimary<FileRow>(
      `SELECT * FROM files WHERE status = 'pending' AND deleted_at IS NULL AND created_at < NOW() - INTERVAL '1 hour'`,
      []
    );
    return result.rows;
  }
}
