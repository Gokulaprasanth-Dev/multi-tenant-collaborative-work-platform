// frontend/src/app/core/models/workspace.model.ts

export interface Workspace {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  ownerUserId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// Shape returned by the backend (snake_case)
export interface WorkspaceDto {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  owner_user_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export function toWorkspace(dto: WorkspaceDto): Workspace {
  return {
    id:          dto.id,
    orgId:       dto.org_id,
    name:        dto.name,
    description: dto.description,
    status:      dto.status,
    ownerUserId: dto.owner_user_id,
    version:     dto.version,
    createdAt:   dto.created_at,
    updatedAt:   dto.updated_at,
  };
}
