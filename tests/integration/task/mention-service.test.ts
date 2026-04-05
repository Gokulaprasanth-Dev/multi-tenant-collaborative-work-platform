/**
 * Integration tests for task/mention.service.ts
 * Requires DATABASE_URL env var.
 * Run: npm run migrate:test && npm run test:integration
 */

import { v4 as uuidv4 } from 'uuid';
import { parseAndCreate } from '../../../src/modules/task/mention.service';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('mention.service integration', () => {
  let authorId: string;
  let mentionedUserId: string;
  let mentionedUserEmailPrefix: string;
  let orgId: string;
  let taskId: string;
  let workspaceId: string;

  beforeAll(async () => {
    // Seed author and the user to be mentioned
    const author = await seedUser();
    authorId = author.userId;

    const mentionedUser = await seedUser();
    mentionedUserId = mentionedUser.userId;
    mentionedUserEmailPrefix = mentionedUser.email.split('@')[0]!;

    // Seed org with author as owner
    const org = await seedOrg({ ownerId: authorId });
    orgId = org.orgId;

    // Add mentionedUser to org_memberships
    await queryPrimary(
      `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
       VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())`,
      [orgId, mentionedUserId]
    );

    // Get default workspace (created by seedOrg)
    const wsResult = await queryPrimary<{ id: string }>(
      `SELECT id FROM workspaces WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );
    workspaceId = wsResult.rows[0]!.id;

    // Create a task to attach mentions to
    const taskResult = await queryPrimary<{ id: string }>(
      `INSERT INTO tasks (org_id, workspace_id, title, status, priority, creator_id, created_at, updated_at, version)
       VALUES ($1, $2, 'Mention Test Task', 'todo', 'medium', $3, NOW(), NOW(), 1)
       RETURNING id`,
      [orgId, workspaceId, authorId]
    );
    taskId = taskResult.rows[0]!.id;
  });

  afterEach(async () => {
    // Clean up outbox_events created during each test
    await queryPrimary(
      `DELETE FROM outbox_events WHERE org_id = $1`,
      [orgId]
    );
  });

  afterAll(async () => {
    // Clean up task
    await queryPrimary(`DELETE FROM tasks WHERE id = $1`, [taskId]);
  });

  // ── parseAndCreate tests ──────────────────────────────────────────────────

  it('returns empty array when body has no mentions', async () => {
    const body = { ops: [{ insert: 'Hello world, no mentions here.' }] };
    const commentId = uuidv4();

    const results = await parseAndCreate(orgId, taskId, commentId, authorId, body);

    expect(results).toEqual([]);
  });

  it('returns MentionResult for a found @handle (match by email prefix)', async () => {
    const body = { ops: [{ insert: `Hey @${mentionedUserEmailPrefix} check this` }] };
    const commentId = uuidv4();

    const results = await parseAndCreate(orgId, taskId, commentId, authorId, body);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      mentionedUserId,
      handle: mentionedUserEmailPrefix.toLowerCase(),
    });
  });

  it('creates outbox event of type mention.created in DB after mention', async () => {
    const body = { ops: [{ insert: `Hey @${mentionedUserEmailPrefix} please review` }] };
    const commentId = uuidv4();

    await parseAndCreate(orgId, taskId, commentId, authorId, body);

    const result = await queryPrimary<{ event_type: string; entity_id: string }>(
      `SELECT event_type, entity_id FROM outbox_events WHERE org_id = $1 AND event_type = 'mention.created' LIMIT 1`,
      [orgId]
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.event_type).toBe('mention.created');
    expect(result.rows[0]!.entity_id).toBe(commentId);
  });

  it('returns empty array when @handle does not match any org member', async () => {
    const body = { ops: [{ insert: '@unknownhandlexyz123 hello' }] };
    const commentId = uuidv4();

    const results = await parseAndCreate(orgId, taskId, commentId, authorId, body);

    expect(results).toEqual([]);
  });

  it('deduplicates repeated @handle — same handle mentioned twice returns 1 result', async () => {
    const handle = mentionedUserEmailPrefix.toLowerCase();
    const body = {
      ops: [{ insert: `@${handle} please review and @${handle} also comment` }],
    };
    const commentId = uuidv4();

    const results = await parseAndCreate(orgId, taskId, commentId, authorId, body);

    expect(results).toHaveLength(1);
    expect(results[0]!.handle).toBe(handle);
  });

  it('matches by name (normalized: lowercase, spaces stripped)', async () => {
    // Seed a user with a known full name
    const namedUser = await seedUser({ name: 'John Doe' });
    await queryPrimary(
      `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
       VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())`,
      [orgId, namedUser.userId]
    );

    // Mention them by normalized name: @johndoe
    const body = { ops: [{ insert: 'Hey @johndoe please take a look' }] };
    const commentId = uuidv4();

    const results = await parseAndCreate(orgId, taskId, commentId, authorId, body);

    expect(results).toHaveLength(1);
    expect(results[0]!.mentionedUserId).toBe(namedUser.userId);
    expect(results[0]!.handle).toBe('johndoe');

    // Cleanup named user membership
    await queryPrimary(
      `DELETE FROM org_memberships WHERE org_id = $1 AND user_id = $2`,
      [orgId, namedUser.userId]
    );
  });
});
