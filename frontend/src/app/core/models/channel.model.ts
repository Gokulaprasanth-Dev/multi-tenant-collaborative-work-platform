// frontend/src/app/core/models/channel.model.ts

export interface Channel {
  id: string;
  orgId: string;
  workspaceId: string | null;
  type: 'direct' | 'group';
  name: string | null;
  createdAt: string;
}

export interface ChannelDto {
  id: string;
  org_id: string;
  workspace_id: string | null;
  type: 'direct' | 'group';
  name: string | null;
  created_at: string;
}

export function toChannel(dto: ChannelDto): Channel {
  return {
    id:          dto.id,
    orgId:       dto.org_id,
    workspaceId: dto.workspace_id,
    type:        dto.type,
    name:        dto.name,
    createdAt:   dto.created_at,
  };
}
