import {
  WorkspaceRepository,
  WorkspaceRow,
  CreateWorkspaceData,
  UpdateWorkspaceData,
} from './workspace.repository';
import { persistAuditLog } from '../audit/workers/audit.worker';
import { queryPrimary } from '../../shared/database/pool';
import { NotFoundError, ConflictError } from '../../shared/errors/app-errors';

const workspaceRepo = new WorkspaceRepository();

async function writeOutboxEvent(
  eventType: string,
  orgId: string,
  entityId: string,
  actorUserId: string | null,
  payload: Record<string, unknown>
): Promise<void> {
  await queryPrimary(
    `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
     VALUES ($1, $2, 'workspace', $3, $4, $5::jsonb, NOW())`,
    [orgId, eventType, entityId, actorUserId, JSON.stringify(payload)]
  );
}

export async function createWorkspace(
  userId: string,
  data: CreateWorkspaceData
): Promise<WorkspaceRow> {
  const workspace = await workspaceRepo.create(data);
  await writeOutboxEvent('workspace.created', data.org_id, workspace.id, userId, {
    workspaceId: workspace.id,
    orgId: data.org_id,
    name: workspace.name,
  });
  return workspace;
}

export async function getWorkspace(orgId: string, workspaceId: string): Promise<WorkspaceRow> {
  const ws = await workspaceRepo.findById(workspaceId);
  if (!ws || ws.org_id !== orgId) throw new NotFoundError('Workspace');
  return ws;
}

export async function listWorkspaces(orgId: string): Promise<WorkspaceRow[]> {
  return workspaceRepo.findByOrg(orgId);
}

export async function updateWorkspace(
  orgId: string,
  workspaceId: string,
  data: UpdateWorkspaceData,
  expectedVersion: number,
  actorId: string
): Promise<WorkspaceRow> {
  const updated = await workspaceRepo.update(orgId, workspaceId, data, expectedVersion);
  if (!updated) {
    const existing = await workspaceRepo.findById(workspaceId);
    if (!existing || existing.org_id !== orgId) throw new NotFoundError('Workspace');
    throw new ConflictError('VERSION_CONFLICT', 'Workspace was modified by another request');
  }
  await writeOutboxEvent('workspace.updated', orgId, workspaceId, actorId, {
    workspaceId,
    orgId,
    changes: data,
  });
  return updated;
}

export async function deleteWorkspace(
  orgId: string,
  workspaceId: string,
  actorId: string
): Promise<void> {
  const existing = await workspaceRepo.findById(workspaceId);
  if (!existing || existing.org_id !== orgId) throw new NotFoundError('Workspace');

  await workspaceRepo.cascadeSoftDelete(orgId, workspaceId);

  await writeOutboxEvent('workspace.deleted', orgId, workspaceId, actorId, {
    workspaceId,
    orgId,
  });

  await persistAuditLog({
    orgId,
    actorId,
    actorType: 'user',
    eventType: 'workspace.deleted',
    entityType: 'workspace',
    entityId: workspaceId,
    payload: { workspaceId, orgId },
  });
}
