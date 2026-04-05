import { queryPrimary, queryReplica } from '../../shared/database/pool';

/**
 * Parses `@username` tokens from a comment body (Quill/JSONB delta format).
 * Extracts mention strings from all text ops in the delta.
 */
function extractMentionHandles(body: Record<string, unknown>): string[] {
  const handles: string[] = [];
  const ops = body['ops'] as Array<{ insert?: unknown; attributes?: unknown }> | undefined;
  if (!Array.isArray(ops)) return handles;

  const mentionRegex = /@([a-zA-Z0-9_.-]+)/g;
  for (const op of ops) {
    if (typeof op.insert === 'string') {
      let match: RegExpExecArray | null;
      while ((match = mentionRegex.exec(op.insert)) !== null) {
        handles.push(match[1].toLowerCase());
      }
    }
  }
  return [...new Set(handles)];
}

export interface MentionResult {
  mentionedUserId: string;
  handle: string;
}

/**
 * Parses mentions from a comment body, looks up users in the org by handle (email prefix or name),
 * and writes outbox `mention.created` events for each found user.
 */
export async function parseAndCreate(
  orgId: string,
  taskId: string,
  commentId: string,
  authorId: string,
  body: Record<string, unknown>
): Promise<MentionResult[]> {
  const handles = extractMentionHandles(body);
  if (handles.length === 0) return [];

  const results: MentionResult[] = [];

  for (const handle of handles) {
    // Look up active org members by name (normalized) or email prefix
    const result = await queryReplica(
      `SELECT u.id
       FROM users u
       JOIN org_memberships m ON m.user_id = u.id
       WHERE m.org_id = $1
         AND m.deleted_at IS NULL
         AND u.deleted_at IS NULL
         AND (
           LOWER(REPLACE(u.name, ' ', '')) = $2
           OR LOWER(SPLIT_PART(u.email, '@', 1)) = $2
         )
       LIMIT 1`,
      [orgId, handle]
    );

    if (result.rows.length === 0) continue;
    const userId = (result.rows[0] as { id: string }).id;

    // Write outbox mention.created
    await queryPrimary(
      `INSERT INTO outbox_events (org_id, event_type, entity_type, entity_id, actor_user_id, payload, occurred_at)
       VALUES ($1, 'mention.created', 'comment', $2, $3, $4::jsonb, NOW())`,
      [
        orgId,
        commentId,
        authorId,
        JSON.stringify({ orgId, taskId, commentId, mentionedUserId: userId, handle }),
      ]
    );

    results.push({ mentionedUserId: userId, handle });
  }

  return results;
}
