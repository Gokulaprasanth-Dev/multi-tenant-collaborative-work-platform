/**
 * TASK-108 — Recurring Task Spawn Worker
 * EXEC-004 fix: plain function (logic) separated from BullMQ registration.
 */

import { RRule } from 'rrule';
import { queryPrimary } from '../../../shared/database/pool';
import { logger } from '../../../shared/observability/logger';

export interface RecurringTaskJobData {
  parentTaskId: string;
  orgId: string;
}

export async function runRecurringTaskJob(data: RecurringTaskJobData): Promise<void> {
  const { parentTaskId, orgId } = data;

  // Load parent task
  const taskResult = await queryPrimary<{
    id: string;
    title: string;
    description: string | null;
    priority: string | null;
    is_recurring: boolean;
    recurrence_rule: string | null;
    workspace_id: string;
    creator_id: string;
  }>(
    `SELECT id, title, description, priority, is_recurring, recurrence_rule, workspace_id, creator_id
     FROM tasks WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [parentTaskId]
  );

  if (taskResult.rows.length === 0) {
    logger.warn({ parentTaskId }, 'recurringTaskWorker: parent task not found');
    return;
  }

  const parent = taskResult.rows[0]!;

  if (!parent.is_recurring || !parent.recurrence_rule) {
    logger.warn({ parentTaskId }, 'recurringTaskWorker: task is not recurring or has no recurrence_rule');
    return;
  }

  // Parse RRULE and compute next occurrence
  let nextOccurrence: Date;
  try {
    const rule = RRule.fromString(parent.recurrence_rule);
    const now = new Date();
    const next = rule.after(now, false);
    if (!next) {
      logger.info({ parentTaskId }, 'recurringTaskWorker: no future occurrence — recurrence ended');
      return;
    }
    nextOccurrence = next;
  } catch (err) {
    logger.error({ err, parentTaskId, recurrenceRule: parent.recurrence_rule }, 'recurringTaskWorker: invalid recurrence_rule');
    return;
  }

  // COMPLETENESS-007 fix: check for existing child task on same due_date to prevent duplicates
  const existingResult = await queryPrimary<{ count: string }>(
    `SELECT COUNT(*) AS count FROM tasks
     WHERE recurrence_parent_id = $1 AND due_date::date = $2::date AND deleted_at IS NULL`,
    [parentTaskId, nextOccurrence]
  );

  if (parseInt(existingResult.rows[0]!.count, 10) > 0) {
    logger.info({ parentTaskId, nextOccurrence }, 'recurringTaskWorker: child task already exists for this date, skipping');
    return;
  }

  // Load assignees
  const assigneesResult = await queryPrimary<{ user_id: string }>(
    `SELECT user_id FROM task_assignees WHERE task_id = $1`,
    [parentTaskId]
  );

  // Create child task
  const newTaskResult = await queryPrimary<{ id: string }>(
    `INSERT INTO tasks (id, org_id, workspace_id, creator_id, title, description, priority, status,
                        is_recurring, recurrence_parent_id, due_date, depth, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'todo', false, $7, $8, 0, NOW(), NOW())
     RETURNING id`,
    [
      orgId,
      parent.workspace_id,
      parent.creator_id,
      parent.title,
      parent.description,
      parent.priority,
      parentTaskId,
      nextOccurrence,
    ]
  );

  const newTaskId = newTaskResult.rows[0]!.id;

  // Copy assignees (system-spawned, so assigned_by = parent creator)
  for (const { user_id } of assigneesResult.rows) {
    await queryPrimary(
      `INSERT INTO task_assignees (task_id, user_id, org_id, assigned_by, assigned_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT DO NOTHING`,
      [newTaskId, user_id, orgId, parent.creator_id]
    );
  }

  // Write outbox task.created
  await queryPrimary(
    `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
     VALUES ($1, 'task.created', 'task', $2, NULL, $3::jsonb, NOW())`,
    [orgId, newTaskId, JSON.stringify({ taskId: newTaskId, parentTaskId, orgId })]
  );

  logger.info({ newTaskId, parentTaskId, nextOccurrence }, 'recurringTaskWorker: child task created');
}
