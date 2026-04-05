import {
  TaskRepository,
  TaskRow,
  CreateTaskData,
  UpdateTaskData,
} from './task.repository';
import { MembershipRepository } from '../organization/repositories/membership.repository';
import { persistAuditLog } from '../audit/workers/audit.worker';
import { enqueue } from '../../shared/queue/queues';
import { queryPrimary } from '../../shared/database/pool';
import * as ActivityLogService from './activity-log.service';
import { AppError, ConflictError, NotFoundError, ForbiddenError } from '../../shared/errors/app-errors';

const taskRepo = new TaskRepository();
const memberRepo = new MembershipRepository();

const MAX_TASK_DEPTH = 2;

// Valid status transitions
const ALLOWED_TRANSITIONS: Record<TaskRow['status'], TaskRow['status'][]> = {
  todo:        ['in_progress', 'cancelled'],
  in_progress: ['in_review', 'done', 'cancelled', 'todo'],
  in_review:   ['in_progress', 'done', 'cancelled'],
  done:        ['todo'],
  cancelled:   ['todo'],
};

async function writeOutboxEvent(
  eventType: string,
  orgId: string,
  entityId: string,
  actorUserId: string | null,
  payload: Record<string, unknown>
): Promise<void> {
  await queryPrimary(
    `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
     VALUES ($1, $2, 'task', $3, $4, $5::jsonb, NOW())`,
    [orgId, eventType, entityId, actorUserId, JSON.stringify(payload)]
  );
}

async function writeActivityLog(
  orgId: string,
  taskId: string,
  actorId: string,
  action: string,
  changes?: Record<string, unknown>
): Promise<void> {
  await ActivityLogService.log(orgId, actorId, action, taskId, changes ?? {});
}

export interface CreateTaskInput {
  workspace_id: string;
  board_id?: string | null;
  parent_task_id?: string | null;
  title: string;
  description?: Record<string, unknown> | null;
  status?: TaskRow['status'];
  priority?: TaskRow['priority'];
  due_date?: Date | null;
  is_recurring?: boolean;
  recurrence_rule?: string | null;
  template_id?: string | null;
  labels?: string[];
  assignee_ids?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: Record<string, unknown> | null;
  status?: TaskRow['status'];
  priority?: TaskRow['priority'];
  due_date?: Date | null;
  board_id?: string | null;
  labels?: string[];
  is_recurring?: boolean;
  recurrence_rule?: string | null;
  assignee_ids?: string[];
  version: number;
}

export async function createTask(
  orgId: string,
  userId: string,
  input: CreateTaskInput
): Promise<TaskRow> {
  // Validate depth
  let depth = 0;
  if (input.parent_task_id) {
    const parent = await taskRepo.findById(input.parent_task_id);
    if (!parent || parent.org_id !== orgId) throw new NotFoundError('ParentTask');
    depth = parent.depth + 1;
    if (depth > MAX_TASK_DEPTH) {
      throw new AppError(422, 'TASK_DEPTH_EXCEEDED', `Tasks can be nested at most ${MAX_TASK_DEPTH} levels deep`);
    }
  }

  // Validate assignees are org members
  if (input.assignee_ids?.length) {
    for (const assigneeId of input.assignee_ids) {
      const membership = await memberRepo.findMembership(orgId, assigneeId);
      if (!membership) {
        throw new AppError(422, 'ASSIGNEE_NOT_IN_ORG', `User ${assigneeId} is not a member of this organization`);
      }
    }
  }

  const createData: CreateTaskData = {
    org_id: orgId,
    workspace_id: input.workspace_id,
    board_id: input.board_id ?? null,
    parent_task_id: input.parent_task_id ?? null,
    depth,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? 'todo',
    priority: input.priority ?? 'medium',
    creator_id: userId,
    due_date: input.due_date ?? null,
    is_recurring: input.is_recurring ?? false,
    recurrence_rule: input.recurrence_rule ?? null,
    template_id: input.template_id ?? null,
    labels: input.labels ?? [],
  };

  const task = await taskRepo.create(createData);

  // Add assignees
  if (input.assignee_ids?.length) {
    for (const assigneeId of input.assignee_ids) {
      await taskRepo.addAssignee(task.id, assigneeId, orgId, userId);
    }
  }

  await writeOutboxEvent('task.created', orgId, task.id, userId, {
    taskId: task.id, orgId, workspaceId: input.workspace_id, title: input.title,
  });
  await writeActivityLog(orgId, task.id, userId, 'task.created');

  return task;
}

export async function updateTask(
  orgId: string,
  taskId: string,
  userId: string,
  input: UpdateTaskInput
): Promise<TaskRow> {
  const existing = await taskRepo.findById(taskId);
  if (!existing || existing.org_id !== orgId) throw new NotFoundError('Task');

  // Authorization: creator or org_admin+
  const membership = await memberRepo.findMembership(orgId, userId);
  const isAdmin = membership?.role === 'org_owner' || membership?.role === 'org_admin';
  if (existing.creator_id !== userId && !isAdmin) {
    throw new ForbiddenError('INSUFFICIENT_ROLE', 'Only the task creator or admins can update this task');
  }

  // Validate status transition
  if (input.status && input.status !== existing.status) {
    const allowed = ALLOWED_TRANSITIONS[existing.status];
    if (!allowed.includes(input.status)) {
      throw new AppError(422, 'INVALID_STATUS_TRANSITION',
        `Cannot transition from ${existing.status} to ${input.status}`);
    }
  }

  const { version, assignee_ids, ...updateData } = input;
  const updated = await taskRepo.update(orgId, taskId, updateData as UpdateTaskData, version);
  if (!updated) {
    const stillExists = await taskRepo.findById(taskId);
    if (!stillExists || stillExists.org_id !== orgId) throw new NotFoundError('Task');
    throw new ConflictError('VERSION_CONFLICT', 'Task was modified by another request');
  }

  // Update assignees if provided
  if (assignee_ids !== undefined) {
    // Remove old assignees and re-add — simple replace strategy
    const currentAssignees = await taskRepo.getAssignees(taskId);
    for (const a of currentAssignees) {
      await taskRepo.removeAssignee(taskId, a.user_id);
    }
    for (const assigneeId of assignee_ids) {
      await taskRepo.addAssignee(taskId, assigneeId, orgId, userId);
    }
  }

  await writeOutboxEvent('task.updated', orgId, taskId, userId, {
    taskId, orgId, changes: updateData,
  });
  await writeActivityLog(orgId, taskId, userId, 'task.updated', updateData);

  // If transitioning to done and task is recurring: enqueue recurring-tasks job
  if (input.status === 'done' && updated.is_recurring) {
    await enqueue('recurring-tasks', 'spawn-next-occurrence', {
      parentTaskId: taskId,
      orgId,
    });
  }

  return updated;
}

export async function deleteTask(
  orgId: string,
  taskId: string,
  userId: string
): Promise<void> {
  const existing = await taskRepo.findById(taskId);
  if (!existing || existing.org_id !== orgId) throw new NotFoundError('Task');

  const membership = await memberRepo.findMembership(orgId, userId);
  const isAdmin = membership?.role === 'org_owner' || membership?.role === 'org_admin';
  if (existing.creator_id !== userId && !isAdmin) {
    throw new ForbiddenError('INSUFFICIENT_ROLE', 'Only the task creator or admins can delete this task');
  }

  await taskRepo.cascadeSoftDelete(orgId, taskId);

  await writeOutboxEvent('task.deleted', orgId, taskId, userId, { taskId, orgId });
  await persistAuditLog({
    orgId,
    actorId: userId,
    actorType: 'user',
    eventType: 'task.deleted',
    entityType: 'task',
    entityId: taskId,
    payload: { taskId, orgId },
  });
}

export async function getTask(orgId: string, taskId: string): Promise<TaskRow> {
  const task = await taskRepo.findById(taskId);
  if (!task || task.org_id !== orgId) throw new NotFoundError('Task');
  return task;
}

export async function listTasks(
  orgId: string,
  filters: { workspaceId?: string; boardId?: string; status?: string } = {}
): Promise<TaskRow[]> {
  return taskRepo.findByOrg(orgId, filters);
}
