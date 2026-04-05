import { queryPrimary, queryReplica } from '../../shared/database/pool';
import { AppError, NotFoundError, ForbiddenError } from '../../shared/errors/app-errors';
import { parseAndCreate } from './mention.service';

export interface CommentRow {
  id: string;
  org_id: string;
  task_id: string;
  author_id: string;
  parent_comment_id: string | null;
  body: Record<string, unknown>;
  is_edited: boolean;
  edited_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCommentInput {
  task_id: string;
  body: Record<string, unknown>;
  parent_comment_id?: string | null;
}

export async function createComment(
  orgId: string,
  authorId: string,
  input: CreateCommentInput
): Promise<CommentRow> {
  // Validate parent is not itself a reply (1-level threading max)
  if (input.parent_comment_id) {
    const parentResult = await queryReplica(
      `SELECT id, parent_comment_id FROM comments WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [input.parent_comment_id, orgId]
    );
    const parent = parentResult.rows[0] as { id: string; parent_comment_id: string | null } | undefined;
    if (!parent) throw new NotFoundError('ParentComment');
    if (parent.parent_comment_id !== null) {
      throw new AppError(422, 'THREADING_DEPTH_EXCEEDED', 'Comments can only be nested one level deep');
    }
  }

  const result = await queryPrimary(
    `INSERT INTO comments (org_id, task_id, author_id, parent_comment_id, body)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [orgId, input.task_id, authorId, input.parent_comment_id ?? null, JSON.stringify(input.body)]
  );
  const comment = result.rows[0] as unknown as CommentRow;

  // Write outbox comment.created
  await queryPrimary(
    `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
     VALUES ($1, 'comment.created', 'comment', $2, $3, $4::jsonb, NOW())`,
    [
      orgId,
      comment.id,
      authorId,
      JSON.stringify({ commentId: comment.id, taskId: input.task_id, orgId }),
    ]
  );

  // Parse and fire mention events
  await parseAndCreate(orgId, input.task_id, comment.id, authorId, input.body);

  return comment;
}

export async function listComments(orgId: string, taskId: string): Promise<CommentRow[]> {
  const result = await queryReplica(
    `SELECT * FROM comments WHERE org_id = $1 AND task_id = $2 AND deleted_at IS NULL ORDER BY created_at ASC`,
    [orgId, taskId]
  );
  return result.rows as unknown as CommentRow[];
}

export async function deleteComment(
  orgId: string,
  commentId: string,
  userId: string
): Promise<void> {
  const check = await queryReplica(
    `SELECT id, author_id FROM comments WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [commentId, orgId]
  );
  if (check.rows.length === 0) throw new NotFoundError('Comment');
  const row = check.rows[0] as { id: string; author_id: string };
  if (row.author_id !== userId) throw new ForbiddenError('NOT_COMMENT_AUTHOR', 'Only the comment author can delete this comment');

  await queryPrimary(
    `UPDATE comments SET deleted_at = NOW() WHERE id = $1`,
    [commentId]
  );
}
