// frontend/src/app/core/models/comment.model.ts

export interface Comment {
  id: string;
  taskId: string;
  authorUserId: string;
  body: Record<string, unknown>;
  createdAt: string;
}

export interface CommentDto {
  id: string;
  task_id: string;
  author_user_id: string;
  body: Record<string, unknown>;
  created_at: string;
}

export function toComment(dto: CommentDto): Comment {
  return {
    id:           dto.id,
    taskId:       dto.task_id,
    authorUserId: dto.author_user_id,
    body:         dto.body,
    createdAt:    dto.created_at,
  };
}
