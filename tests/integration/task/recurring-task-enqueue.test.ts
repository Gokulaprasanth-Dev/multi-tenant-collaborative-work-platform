/**
 * Regression test: marking a recurring task 'done' must enqueue
 * a BullMQ job with parentTaskId (not taskId).
 *
 * Bug: task.service.ts previously sent { taskId, recurrenceRule, dueDate }
 * but the recurring-task worker expects { parentTaskId, orgId }.
 */

import { v4 as uuidv4 } from 'uuid';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import { queues } from '../../../src/shared/queue/queues';
import * as taskService from '../../../src/modules/task/task.service';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('Recurring task enqueue regression', () => {
  let orgId: string;
  let userId: string;
  let workspaceId: string;

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

  afterEach(async () => {
    // Drain the recurring-tasks queue to prevent interference between tests
    await queues['recurring-tasks'].drain();
  });

  it('enqueues spawn-next-occurrence with parentTaskId when recurring task is marked done', async () => {
    // Create a recurring task
    const task = await taskService.createTask(orgId, userId, {
      workspace_id: workspaceId,
      title: 'Recurring Bug Regression Task',
      status: 'in_progress',
      is_recurring: true,
      recurrence_rule: 'FREQ=DAILY',
    });

    // Mark it done (triggers enqueue)
    await taskService.updateTask(orgId, task.id, userId, {
      status: 'done',
      version: task.version,
    });

    // Check what was enqueued
    const jobs = await queues['recurring-tasks'].getJobs(['waiting', 'delayed', 'active']);
    const spawnJob = jobs.find(j => j.name === 'spawn-next-occurrence');

    expect(spawnJob).toBeDefined();
    expect(spawnJob!.data.parentTaskId).toBe(task.id);
    expect(spawnJob!.data.orgId).toBe(orgId);
    // Bug: previously sent 'taskId' instead of 'parentTaskId'
    expect((spawnJob!.data as Record<string, unknown>).taskId).toBeUndefined();
  });

  it('does not enqueue spawn-next-occurrence for non-recurring task marked done', async () => {
    const task = await taskService.createTask(orgId, userId, {
      workspace_id: workspaceId,
      title: 'Non-Recurring Task',
      status: 'in_progress',
      is_recurring: false,
    });

    await taskService.updateTask(orgId, task.id, userId, {
      status: 'done',
      version: task.version,
    });

    const jobs = await queues['recurring-tasks'].getJobs(['waiting', 'delayed', 'active']);
    const spawnJob = jobs.find(j => j.data.parentTaskId === task.id);
    expect(spawnJob).toBeUndefined();
  });
});
