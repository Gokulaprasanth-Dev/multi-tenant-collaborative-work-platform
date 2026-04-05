import { TaskRepository, TaskRow } from './task.repository';
import { MembershipRepository } from '../organization/repositories/membership.repository';
import { withTransaction } from '../../shared/database/pool';
import { AppError, ForbiddenError } from '../../shared/errors/app-errors';

const taskRepo = new TaskRepository();
const memberRepo = new MembershipRepository();

const BULK_MAX = 100;

export interface BulkStatusUpdate {
  taskIds: string[];
  status: TaskRow['status'];
}

export interface BulkDeleteInput {
  taskIds: string[];
}

async function assertAdminOrOwner(orgId: string, userId: string): Promise<void> {
  const membership = await memberRepo.findMembership(orgId, userId);
  const role = membership?.role;
  if (role !== 'org_owner' && role !== 'org_admin') {
    throw new ForbiddenError('INSUFFICIENT_ROLE', 'Bulk operations require org_admin or org_owner role');
  }
}

export async function bulkUpdateStatus(
  orgId: string,
  userId: string,
  input: BulkStatusUpdate
): Promise<{ updated: number }> {
  if (input.taskIds.length === 0 || input.taskIds.length > BULK_MAX) {
    throw new AppError(422, 'BULK_SIZE_INVALID', `Bulk operations require 1–${BULK_MAX} task IDs`);
  }
  await assertAdminOrOwner(orgId, userId);

  const updated = await withTransaction(async (client) => {
    return taskRepo.bulkUpdateStatus(orgId, input.taskIds, input.status, client);
  });

  return { updated };
}

export async function bulkDelete(
  orgId: string,
  userId: string,
  input: BulkDeleteInput
): Promise<{ deleted: number }> {
  if (input.taskIds.length === 0 || input.taskIds.length > BULK_MAX) {
    throw new AppError(422, 'BULK_SIZE_INVALID', `Bulk operations require 1–${BULK_MAX} task IDs`);
  }
  await assertAdminOrOwner(orgId, userId);

  const deleted = await withTransaction(async (client) => {
    return taskRepo.bulkSoftDelete(orgId, input.taskIds, client);
  });

  return { deleted };
}
