import { PoolClient } from 'pg';
import { queryPrimary, queryReplica, withTransaction } from '../../shared/database/pool';

export interface WorkspaceRow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  owner_user_id: string;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}

export interface CreateWorkspaceData {
  org_id: string;
  name: string;
  description?: string | null;
  owner_user_id: string;
}

export interface UpdateWorkspaceData {
  name?: string;
  description?: string | null;
  status?: 'active' | 'archived';
}

export class WorkspaceRepository {
  async findById(id: string, client?: PoolClient): Promise<WorkspaceRow | null> {
    const sql = `SELECT * FROM workspaces WHERE id = $1 AND deleted_at IS NULL LIMIT 1`;
    const result = client
      ? await client.query(sql, [id])
      : await queryReplica(sql, [id]);
    return (result.rows[0] as unknown as WorkspaceRow) ?? null;
  }

  async findByOrg(orgId: string): Promise<WorkspaceRow[]> {
    const result = await queryReplica(
      `SELECT * FROM workspaces WHERE org_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [orgId]
    );
    return result.rows as unknown as WorkspaceRow[];
  }

  async create(data: CreateWorkspaceData, client?: PoolClient): Promise<WorkspaceRow> {
    const sql = `
      INSERT INTO workspaces (org_id, name, description, owner_user_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *`;
    const params = [data.org_id, data.name, data.description ?? null, data.owner_user_id];
    const result = client
      ? await client.query(sql, params)
      : await queryPrimary(sql, params);
    return result.rows[0] as unknown as WorkspaceRow;
  }

  async update(
    orgId: string,
    id: string,
    data: UpdateWorkspaceData,
    expectedVersion: number
  ): Promise<WorkspaceRow | null> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) { setClauses.push(`name = $${idx++}`); params.push(data.name); }
    if (data.description !== undefined) { setClauses.push(`description = $${idx++}`); params.push(data.description); }
    if (data.status !== undefined) { setClauses.push(`status = $${idx++}`); params.push(data.status); }

    if (setClauses.length === 0) return this.findById(id);

    setClauses.push(`version = version + 1`);
    params.push(orgId, id, expectedVersion);

    const result = await queryPrimary(
      `UPDATE workspaces SET ${setClauses.join(', ')}
       WHERE org_id = $${idx++} AND id = $${idx++} AND version = $${idx++} AND deleted_at IS NULL
       RETURNING *`,
      params
    );
    return result.rows.length > 0 ? (result.rows[0] as unknown as WorkspaceRow) : null;
  }

  async softDelete(orgId: string, id: string, client?: PoolClient): Promise<boolean> {
    const sql = `
      UPDATE workspaces SET deleted_at = NOW()
      WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
      RETURNING id`;
    const result = client
      ? await client.query(sql, [id, orgId])
      : await queryPrimary(sql, [id, orgId]);
    return result.rows.length > 0;
  }

  /**
   * Cascade soft-delete: workspace → boards → tasks in a single transaction.
   * Uses explicit multi-statement approach within one transaction for clarity and correctness.
   */
  async cascadeSoftDelete(orgId: string, workspaceId: string): Promise<void> {
    await withTransaction(async (client) => {
      // 1. Soft-delete all tasks in the workspace
      await client.query(
        `UPDATE tasks SET deleted_at = NOW()
         WHERE workspace_id = $1 AND org_id = $2 AND deleted_at IS NULL`,
        [workspaceId, orgId]
      );

      // 2. Soft-delete all boards in the workspace
      await client.query(
        `UPDATE boards SET deleted_at = NOW()
         WHERE workspace_id = $1 AND org_id = $2 AND deleted_at IS NULL`,
        [workspaceId, orgId]
      );

      // 3. Soft-delete the workspace itself
      await client.query(
        `UPDATE workspaces SET deleted_at = NOW()
         WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
        [workspaceId, orgId]
      );
    });
  }
}
