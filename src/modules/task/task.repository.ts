import { PoolClient } from 'pg';
import { queryPrimary, queryReplica, withTransaction } from '../../shared/database/pool';

export interface TaskRow {
  id: string;
  org_id: string;
  workspace_id: string;
  board_id: string | null;
  parent_task_id: string | null;
  depth: number;
  title: string;
  description: Record<string, unknown> | null;
  status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  creator_id: string;
  due_date: Date | null;
  completed_at: Date | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
  recurrence_parent_id: string | null;
  template_id: string | null;
  labels: string[];
  attachments_count: number;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}

export interface TaskAssigneeRow {
  task_id: string;
  user_id: string;
  org_id: string;
  assigned_at: Date;
  assigned_by: string;
}

export interface TaskDependencyRow {
  id: string;
  org_id: string;
  blocking_task_id: string;
  blocked_task_id: string;
  created_by: string;
  created_at: Date;
}

export interface CreateTaskData {
  org_id: string;
  workspace_id: string;
  board_id?: string | null;
  parent_task_id?: string | null;
  depth?: number;
  title: string;
  description?: Record<string, unknown> | null;
  status?: TaskRow['status'];
  priority?: TaskRow['priority'];
  creator_id: string;
  due_date?: Date | null;
  is_recurring?: boolean;
  recurrence_rule?: string | null;
  recurrence_parent_id?: string | null;
  template_id?: string | null;
  labels?: string[];
}

export interface UpdateTaskData {
  title?: string;
  description?: Record<string, unknown> | null;
  status?: TaskRow['status'];
  priority?: TaskRow['priority'];
  due_date?: Date | null;
  board_id?: string | null;
  labels?: string[];
  is_recurring?: boolean;
  recurrence_rule?: string | null;
}

export class TaskRepository {
  async findById(id: string, client?: PoolClient): Promise<TaskRow | null> {
    const sql = `SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL LIMIT 1`;
    const result = client
      ? await client.query(sql, [id])
      : await queryPrimary(sql, [id]);
    return (result.rows[0] as unknown as TaskRow) ?? null;
  }

  async findByOrg(
    orgId: string,
    filters: { workspaceId?: string; boardId?: string; status?: string } = {}
  ): Promise<TaskRow[]> {
    const conditions: string[] = ['org_id = $1', 'deleted_at IS NULL'];
    const params: unknown[] = [orgId];
    let idx = 2;

    if (filters.workspaceId) { conditions.push(`workspace_id = $${idx++}`); params.push(filters.workspaceId); }
    if (filters.boardId) { conditions.push(`board_id = $${idx++}`); params.push(filters.boardId); }
    if (filters.status) { conditions.push(`status = $${idx++}`); params.push(filters.status); }

    const result = await queryReplica(
      `SELECT * FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC`,
      params
    );
    return result.rows as unknown as TaskRow[];
  }

  async create(data: CreateTaskData, client?: PoolClient): Promise<TaskRow> {
    const sql = `
      INSERT INTO tasks (
        org_id, workspace_id, board_id, parent_task_id, depth, title, description,
        status, priority, creator_id, due_date, is_recurring, recurrence_rule,
        recurrence_parent_id, template_id, labels
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`;
    const params = [
      data.org_id,
      data.workspace_id,
      data.board_id ?? null,
      data.parent_task_id ?? null,
      data.depth ?? 0,
      data.title,
      data.description ? JSON.stringify(data.description) : null,
      data.status ?? 'todo',
      data.priority ?? 'medium',
      data.creator_id,
      data.due_date ?? null,
      data.is_recurring ?? false,
      data.recurrence_rule ?? null,
      data.recurrence_parent_id ?? null,
      data.template_id ?? null,
      data.labels ?? [],
    ];
    const result = client
      ? await client.query(sql, params)
      : await queryPrimary(sql, params);
    return result.rows[0] as unknown as TaskRow;
  }

  async update(
    orgId: string,
    taskId: string,
    data: UpdateTaskData,
    expectedVersion: number,
    client?: PoolClient
  ): Promise<TaskRow | null> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.title !== undefined) { setClauses.push(`title = $${idx++}`); params.push(data.title); }
    if (data.description !== undefined) { setClauses.push(`description = $${idx++}`); params.push(data.description ? JSON.stringify(data.description) : null); }
    if (data.status !== undefined) {
      setClauses.push(`status = $${idx++}`);
      params.push(data.status);
      if (data.status === 'done') { setClauses.push(`completed_at = NOW()`); }
    }
    if (data.priority !== undefined) { setClauses.push(`priority = $${idx++}`); params.push(data.priority); }
    if (data.due_date !== undefined) { setClauses.push(`due_date = $${idx++}`); params.push(data.due_date); }
    if (data.board_id !== undefined) { setClauses.push(`board_id = $${idx++}`); params.push(data.board_id); }
    if (data.labels !== undefined) { setClauses.push(`labels = $${idx++}`); params.push(data.labels); }
    if (data.is_recurring !== undefined) { setClauses.push(`is_recurring = $${idx++}`); params.push(data.is_recurring); }
    if (data.recurrence_rule !== undefined) { setClauses.push(`recurrence_rule = $${idx++}`); params.push(data.recurrence_rule); }

    if (setClauses.length === 0) return this.findById(taskId);

    setClauses.push(`version = version + 1`);
    params.push(orgId, taskId, expectedVersion);

    const sql = `
      UPDATE tasks SET ${setClauses.join(', ')}
      WHERE org_id = $${idx++} AND id = $${idx++} AND version = $${idx++} AND deleted_at IS NULL
      RETURNING *`;
    const result = client
      ? await client.query(sql, params)
      : await queryPrimary(sql, params);
    return result.rows.length > 0 ? (result.rows[0] as unknown as TaskRow) : null;
  }

  async softDelete(orgId: string, taskId: string, client?: PoolClient): Promise<boolean> {
    const sql = `
      UPDATE tasks SET deleted_at = NOW()
      WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
      RETURNING id`;
    const result = client
      ? await client.query(sql, [taskId, orgId])
      : await queryPrimary(sql, [taskId, orgId]);
    return result.rows.length > 0;
  }

  /**
   * Cascade soft-delete: task + all subtasks (depth 1 and 2) in a single transaction.
   */
  async cascadeSoftDelete(orgId: string, taskId: string): Promise<void> {
    await withTransaction(async (client) => {
      // Delete subtasks first (depth 1 and 2)
      await client.query(
        `WITH RECURSIVE subtasks AS (
           SELECT id FROM tasks WHERE parent_task_id = $1 AND org_id = $2 AND deleted_at IS NULL
           UNION ALL
           SELECT t.id FROM tasks t
           JOIN subtasks s ON t.parent_task_id = s.id
           WHERE t.org_id = $2 AND t.deleted_at IS NULL
         )
         UPDATE tasks SET deleted_at = NOW()
         WHERE id IN (SELECT id FROM subtasks)`,
        [taskId, orgId]
      );
      // Delete the root task
      await client.query(
        `UPDATE tasks SET deleted_at = NOW() WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
        [taskId, orgId]
      );
    });
  }

  async findChildren(orgId: string, parentTaskId: string): Promise<TaskRow[]> {
    const result = await queryReplica(
      `SELECT * FROM tasks WHERE parent_task_id = $1 AND org_id = $2 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [parentTaskId, orgId]
    );
    return result.rows as unknown as TaskRow[];
  }

  // ── Assignees ─────────────────────────────────────────────────────────────

  async addAssignee(
    taskId: string,
    userId: string,
    orgId: string,
    assignedBy: string,
    client?: PoolClient
  ): Promise<void> {
    const sql = `
      INSERT INTO task_assignees (task_id, user_id, org_id, assigned_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (task_id, user_id) DO NOTHING`;
    if (client) {
      await client.query(sql, [taskId, userId, orgId, assignedBy]);
    } else {
      await queryPrimary(sql, [taskId, userId, orgId, assignedBy]);
    }
  }

  async removeAssignee(taskId: string, userId: string): Promise<void> {
    await queryPrimary(
      `DELETE FROM task_assignees WHERE task_id = $1 AND user_id = $2`,
      [taskId, userId]
    );
  }

  async getAssignees(taskId: string): Promise<TaskAssigneeRow[]> {
    const result = await queryReplica(
      `SELECT * FROM task_assignees WHERE task_id = $1`,
      [taskId]
    );
    return result.rows as unknown as TaskAssigneeRow[];
  }

  // ── Dependencies ──────────────────────────────────────────────────────────

  async findDependencies(orgId: string, taskId: string): Promise<TaskDependencyRow[]> {
    const result = await queryReplica(
      `SELECT * FROM task_dependencies WHERE org_id = $1 AND (blocking_task_id = $2 OR blocked_task_id = $2)`,
      [orgId, taskId]
    );
    return result.rows as unknown as TaskDependencyRow[];
  }

  async insertDependency(
    orgId: string,
    blockingTaskId: string,
    blockedTaskId: string,
    createdBy: string
  ): Promise<TaskDependencyRow> {
    const result = await queryPrimary(
      `INSERT INTO task_dependencies (org_id, blocking_task_id, blocked_task_id, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [orgId, blockingTaskId, blockedTaskId, createdBy]
    );
    return result.rows[0] as unknown as TaskDependencyRow;
  }

  async deleteDependency(orgId: string, dependencyId: string): Promise<void> {
    await queryPrimary(
      `DELETE FROM task_dependencies WHERE id = $1 AND org_id = $2`,
      [dependencyId, orgId]
    );
  }

  // ── Bulk operations ───────────────────────────────────────────────────────

  async bulkUpdateStatus(
    orgId: string,
    taskIds: string[],
    status: TaskRow['status'],
    client?: PoolClient
  ): Promise<number> {
    if (taskIds.length === 0) return 0;
    const placeholders = taskIds.map((_, i) => `$${i + 3}`).join(',');
    const sql = `
      UPDATE tasks SET status = $1${status === 'done' ? ', completed_at = NOW()' : ''}
      WHERE org_id = $2 AND id IN (${placeholders}) AND deleted_at IS NULL`;
    const result = client
      ? await client.query(sql, [status, orgId, ...taskIds])
      : await queryPrimary(sql, [status, orgId, ...taskIds]);
    return result.rowCount ?? 0;
  }

  async bulkSoftDelete(orgId: string, taskIds: string[], client?: PoolClient): Promise<number> {
    if (taskIds.length === 0) return 0;
    const placeholders = taskIds.map((_, i) => `$${i + 2}`).join(',');
    const sql = `
      UPDATE tasks SET deleted_at = NOW()
      WHERE org_id = $1 AND id IN (${placeholders}) AND deleted_at IS NULL`;
    const result = client
      ? await client.query(sql, [orgId, ...taskIds])
      : await queryPrimary(sql, [orgId, ...taskIds]);
    return result.rowCount ?? 0;
  }
}
