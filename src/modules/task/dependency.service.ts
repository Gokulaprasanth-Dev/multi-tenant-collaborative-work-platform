import { TaskRepository, TaskDependencyRow } from './task.repository';
import { AppError, NotFoundError } from '../../shared/errors/app-errors';
import { queryPrimary } from '../../shared/database/pool';

const taskRepo = new TaskRepository();

/**
 * DFS cycle detection: returns true if adding blockingTaskId → blockedTaskId would create a cycle.
 * Traverses the "blocking" direction upward from blockedTaskId.
 */
async function wouldCreateCycle(
  orgId: string,
  blockingTaskId: string,
  blockedTaskId: string
): Promise<boolean> {
  const visited = new Set<string>();
  const stack = [blockedTaskId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === blockingTaskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    // Find tasks that `current` blocks (i.e., current is the blocking_task_id)
    const result = await queryPrimary(
      `SELECT blocked_task_id FROM task_dependencies WHERE org_id = $1 AND blocking_task_id = $2`,
      [orgId, current]
    );
    for (const row of result.rows as Array<{ blocked_task_id: string }>) {
      stack.push(row.blocked_task_id);
    }
  }

  return false;
}

export async function addDependency(
  orgId: string,
  blockingTaskId: string,
  blockedTaskId: string,
  createdBy: string
): Promise<TaskDependencyRow> {
  // Self-dependency check
  if (blockingTaskId === blockedTaskId) {
    throw new AppError(422, 'SELF_DEPENDENCY', 'A task cannot depend on itself');
  }

  // Validate both tasks exist in the same org
  const [blocking, blocked] = await Promise.all([
    taskRepo.findById(blockingTaskId),
    taskRepo.findById(blockedTaskId),
  ]);
  if (!blocking || blocking.org_id !== orgId) throw new NotFoundError('BlockingTask');
  if (!blocked || blocked.org_id !== orgId) throw new NotFoundError('BlockedTask');

  // Validate same workspace
  if (blocking.workspace_id !== blocked.workspace_id) {
    throw new AppError(422, 'CROSS_WORKSPACE_DEPENDENCY', 'Task dependencies must be within the same workspace');
  }

  // Cycle detection
  if (await wouldCreateCycle(orgId, blockingTaskId, blockedTaskId)) {
    throw new AppError(422, 'DEPENDENCY_CYCLE', 'Adding this dependency would create a cycle');
  }

  return taskRepo.insertDependency(orgId, blockingTaskId, blockedTaskId, createdBy);
}

export async function removeDependency(orgId: string, dependencyId: string): Promise<void> {
  await taskRepo.deleteDependency(orgId, dependencyId);
}

export async function listDependencies(orgId: string, taskId: string): Promise<TaskDependencyRow[]> {
  return taskRepo.findDependencies(orgId, taskId);
}
