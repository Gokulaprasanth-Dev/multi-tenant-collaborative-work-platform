import { queryPrimary, queryReplica } from '../../shared/database/pool';

export interface ActivityLogRow {
  id: string;
  org_id: string;
  task_id: string;
  actor_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

export async function log(
  orgId: string,
  actorId: string,
  eventType: string,
  taskId: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  await queryPrimary(
    `INSERT INTO task_activity_log (org_id, task_id, actor_id, event_type, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [orgId, taskId, actorId, eventType, JSON.stringify(payload)]
  );
}

export async function listForTask(orgId: string, taskId: string): Promise<ActivityLogRow[]> {
  const result = await queryReplica(
    `SELECT * FROM task_activity_log WHERE org_id = $1 AND task_id = $2 ORDER BY created_at ASC`,
    [orgId, taskId]
  );
  return result.rows as unknown as ActivityLogRow[];
}

export async function listForOrg(
  orgId: string,
  limit = 100,
  offset = 0
): Promise<ActivityLogRow[]> {
  const result = await queryReplica(
    `SELECT * FROM task_activity_log WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [orgId, limit, offset]
  );
  return result.rows as unknown as ActivityLogRow[];
}
