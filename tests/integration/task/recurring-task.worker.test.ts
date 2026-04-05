/**
 * Integration tests for recurring task worker (Phase 4)
 *
 * Covers:
 * - Worker creates a child task with correct recurrence_parent_id
 * - Assignees are copied to child task
 * - Outbox event is written
 * - Duplicate prevention: worker is idempotent on same due date
 * - Worker no-ops if task is not recurring
 * - Worker no-ops if task not found
 */

import { v4 as uuidv4 } from 'uuid';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import { runRecurringTaskJob } from '../../../src/modules/task/workers/recurring-task.worker';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Recurring Task Worker', () => {
  let orgId: string;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    const owner = await seedUser();
    userId = owner.userId;
    const org = await seedOrg({ ownerId: owner.userId });
    orgId = org.orgId;

    const ws = await queryPrimary<{ id: string }>(
      `SELECT id FROM workspaces WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );
    workspaceId = ws.rows[0]!.id;
  });

  async function createRecurringTask(rrule: string): Promise<string> {
    const result = await queryPrimary<{ id: string }>(
      `INSERT INTO tasks (org_id, workspace_id, creator_id, title, status, priority, depth,
                          is_recurring, recurrence_rule, due_date, created_at, updated_at)
       VALUES ($1, $2, $3, 'Recurring Task', 'todo', 'medium', 0, true, $4,
               NOW() - INTERVAL '1 day', NOW(), NOW())
       RETURNING id`,
      [orgId, workspaceId, userId, rrule]
    );
    return result.rows[0]!.id;
  }

  it('creates a child task with correct recurrence_parent_id', async () => {
    const parentId = await createRecurringTask('FREQ=DAILY');

    await runRecurringTaskJob({ parentTaskId: parentId, orgId });

    const child = await queryPrimary<{ id: string; recurrence_parent_id: string }>(
      `SELECT id, recurrence_parent_id FROM tasks
       WHERE recurrence_parent_id = $1 AND deleted_at IS NULL`,
      [parentId]
    );

    expect(child.rows.length).toBe(1);
    expect(child.rows[0]!.recurrence_parent_id).toBe(parentId);
  });

  it('child task inherits title and priority from parent', async () => {
    const parentId = await createRecurringTask('FREQ=WEEKLY');

    await runRecurringTaskJob({ parentTaskId: parentId, orgId });

    const child = await queryPrimary<{ title: string; priority: string; status: string }>(
      `SELECT title, priority, status FROM tasks
       WHERE recurrence_parent_id = $1 AND deleted_at IS NULL`,
      [parentId]
    );

    expect(child.rows.length).toBe(1);
    expect(child.rows[0]!.title).toBe('Recurring Task');
    expect(child.rows[0]!.priority).toBe('medium');
    expect(child.rows[0]!.status).toBe('todo');
  });

  it('copies assignees to child task', async () => {
    const member = await seedUser();
    await queryPrimary(
      `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
       VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())`,
      [orgId, member.userId]
    );

    const parentId = await createRecurringTask('FREQ=DAILY');
    await queryPrimary(
      `INSERT INTO task_assignees (task_id, user_id, org_id, assigned_by, assigned_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [parentId, member.userId, orgId, userId]
    );

    await runRecurringTaskJob({ parentTaskId: parentId, orgId });

    const child = await queryPrimary<{ id: string }>(
      `SELECT id FROM tasks WHERE recurrence_parent_id = $1 AND deleted_at IS NULL`,
      [parentId]
    );
    const childId = child.rows[0]!.id;

    const assignees = await queryPrimary<{ user_id: string }>(
      `SELECT user_id FROM task_assignees WHERE task_id = $1`,
      [childId]
    );
    expect(assignees.rows.map(r => r.user_id)).toContain(member.userId);
  });

  it('writes a task.created outbox event', async () => {
    const parentId = await createRecurringTask('FREQ=DAILY');

    await runRecurringTaskJob({ parentTaskId: parentId, orgId });

    const child = await queryPrimary<{ id: string }>(
      `SELECT id FROM tasks WHERE recurrence_parent_id = $1 AND deleted_at IS NULL`,
      [parentId]
    );
    const childId = child.rows[0]!.id;

    const outbox = await queryPrimary<{ event_type: string }>(
      `SELECT event_type FROM outbox_events WHERE entity_id = $1 AND org_id = $2`,
      [childId, orgId]
    );
    expect(outbox.rows.length).toBeGreaterThanOrEqual(1);
    expect(outbox.rows[0]!.event_type).toBe('task.created');
  });

  it('is idempotent — does not create duplicate for same due date', async () => {
    const parentId = await createRecurringTask('FREQ=DAILY');

    // Run twice
    await runRecurringTaskJob({ parentTaskId: parentId, orgId });
    await runRecurringTaskJob({ parentTaskId: parentId, orgId });

    const children = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM tasks
       WHERE recurrence_parent_id = $1 AND deleted_at IS NULL`,
      [parentId]
    );
    expect(parseInt(children.rows[0]!.count, 10)).toBe(1);
  });

  it('no-ops if task is not recurring', async () => {
    const result = await queryPrimary<{ id: string }>(
      `INSERT INTO tasks (org_id, workspace_id, creator_id, title, status, priority, depth,
                          is_recurring, created_at, updated_at)
       VALUES ($1, $2, $3, 'Non-Recurring', 'todo', 'medium', 0, false, NOW(), NOW())
       RETURNING id`,
      [orgId, workspaceId, userId]
    );
    const taskId = result.rows[0]!.id;

    await runRecurringTaskJob({ parentTaskId: taskId, orgId });

    const children = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM tasks WHERE recurrence_parent_id = $1`,
      [taskId]
    );
    expect(parseInt(children.rows[0]!.count, 10)).toBe(0);
  });

  it('no-ops for non-existent task', async () => {
    // Should not throw
    await expect(runRecurringTaskJob({ parentTaskId: uuidv4(), orgId })).resolves.not.toThrow();
  });
});
