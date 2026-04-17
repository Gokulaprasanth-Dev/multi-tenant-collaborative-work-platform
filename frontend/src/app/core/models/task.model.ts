// frontend/src/app/core/models/task.model.ts

export type TaskStatus   = 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
  id: string;
  orgId: string;
  workspaceId: string;
  title: string;
  description: Record<string, unknown> | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeIds: string[];
  dueDate: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDto {
  id: string;
  org_id: string;
  workspace_id: string;
  title: string;
  description: Record<string, unknown> | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_ids: string[];
  due_date: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export function toTask(dto: TaskDto): Task {
  return {
    id:          dto.id,
    orgId:       dto.org_id,
    workspaceId: dto.workspace_id,
    title:       dto.title,
    description: dto.description,
    status:      dto.status,
    priority:    dto.priority,
    assigneeIds: dto.assignee_ids ?? [],
    dueDate:     dto.due_date,
    version:     dto.version,
    createdAt:   dto.created_at,
    updatedAt:   dto.updated_at,
  };
}
