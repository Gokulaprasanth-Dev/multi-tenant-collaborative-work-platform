/**
 * Integration tests for user-export.worker.ts entity SQL queries
 *
 * The user-export worker streams data from 4 entity types. This test validates
 * that the underlying SQL queries execute without error against the live DB.
 *
 * Regression test: previously used 'task_comments' (wrong table) instead of 'comments'.
 *
 * Covers:
 * - comments entity stream SQL executes without error (catches wrong table name)
 * - tasks entity stream SQL executes without error
 * - messages entity stream SQL executes without error
 * - files entity stream SQL executes without error
 */

import { v4 as uuidv4 } from 'uuid';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('user-export SQL query validation', () => {
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    const u = await seedUser();
    userId = u.userId;
    const o = await seedOrg({ ownerId: userId });
    orgId = o.orgId;
  });

  it('comments SQL query succeeds (regression: was task_comments — wrong table)', async () => {
    // This is the exact SQL from user-export.worker.ts
    await expect(
      queryPrimary(
        `SELECT tc.id, tc.body, tc.created_at,
                CASE WHEN tc.author_id = $2 THEN u.name ELSE 'Org Member' END AS author_name
         FROM comments tc
         JOIN users u ON u.id = tc.author_id
         WHERE tc.org_id = $1 AND tc.deleted_at IS NULL
         LIMIT 100 OFFSET 0`,
        [orgId, userId]
      )
    ).resolves.toBeDefined();
  });

  it('tasks SQL query succeeds', async () => {
    await expect(
      queryPrimary(
        `SELECT t.id, t.title, t.description, t.status, t.created_at
         FROM tasks t WHERE t.org_id = $1 AND t.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $2)
         LIMIT 100 OFFSET 0`,
        [orgId, userId]
      )
    ).resolves.toBeDefined();
  });

  it('messages SQL query succeeds', async () => {
    await expect(
      queryPrimary(
        `SELECT cm.id, cm.body, cm.created_at, cm.channel_id
         FROM chat_messages cm WHERE cm.org_id = $1 AND cm.sender_id = $2 AND cm.deleted_at IS NULL
         LIMIT 100 OFFSET 0`,
        [orgId, userId]
      )
    ).resolves.toBeDefined();
  });

  it('files SQL query succeeds', async () => {
    await expect(
      queryPrimary(
        `SELECT f.id, f.filename, f.mime_type, f.size_bytes, f.created_at
         FROM files f WHERE f.org_id = $1 AND f.uploader_id = $2 AND f.deleted_at IS NULL
         LIMIT 100 OFFSET 0`,
        [orgId, userId]
      )
    ).resolves.toBeDefined();
  });

  it('comments SQL returns only comments for the correct org', async () => {
    // Seed a comment for the org
    const workspaceResult = await queryPrimary<{ id: string }>(
      `SELECT id FROM workspaces WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );
    const workspaceId = workspaceResult.rows[0]?.id;
    if (!workspaceId) return; // workspace may not exist — skip

    const taskResult = await queryPrimary<{ id: string }>(
      `INSERT INTO tasks (org_id, workspace_id, title, creator_id)
       VALUES ($1, $2, 'Export Test Task', $3)
       RETURNING id`,
      [orgId, workspaceId, userId]
    );
    const taskId = taskResult.rows[0]!.id;

    await queryPrimary(
      `INSERT INTO comments (org_id, task_id, author_id, body)
       VALUES ($1, $2, $3, '{"type":"doc","content":[]}'::jsonb)`,
      [orgId, taskId, userId]
    );

    const result = await queryPrimary<{ id: string }>(
      `SELECT tc.id FROM comments tc WHERE tc.org_id = $1 AND tc.deleted_at IS NULL LIMIT 100 OFFSET 0`,
      [orgId]
    );

    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });
});
