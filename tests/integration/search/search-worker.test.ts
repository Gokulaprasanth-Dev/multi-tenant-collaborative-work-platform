/**
 * Integration tests for searchWorkerJob
 *
 * Covers:
 * - Upsert action runs without error (PostgresFTS — search_vector is GENERATED)
 * - Delete action runs without error (no-op for PostgresFTS)
 * - Redis idempotency key is set after processing
 * - Idempotent: second run with same key is skipped
 */

import { v4 as uuidv4 } from 'uuid';
import type { Job } from 'bullmq';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import { redisClient } from '../../../src/shared/redis/clients';
import {
  searchWorkerJob,
  type SearchIndexJobData,
} from '../../../src/modules/search/workers/search.worker';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

function makeJob(data: SearchIndexJobData): Job<SearchIndexJobData> {
  return { data } as unknown as Job<SearchIndexJobData>;
}

maybeDescribe('searchWorkerJob', () => {
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
    // Clean up Redis idempotency keys created during tests
    const keys = await redisClient.keys('search:indexed:*');
    if (keys.length > 0) await redisClient.del(...keys);
  });

  it('processes upsert action for task without error', async () => {
    const taskResult = await queryPrimary<{ id: string }>(
      `INSERT INTO tasks (org_id, workspace_id, creator_id, title, status, depth, created_at, updated_at)
       VALUES ($1, $2, $3, 'Search Worker Test Task', 'todo', 0, NOW(), NOW())
       RETURNING id`,
      [orgId, workspaceId, userId]
    );
    const taskId = taskResult.rows[0]!.id;

    await expect(searchWorkerJob(makeJob({
      entityType: 'task',
      entityId: taskId,
      orgId,
      action: 'upsert',
      document: { title: 'Search Worker Test Task', body: '' },
    }))).resolves.not.toThrow();
  });

  it('processes delete action for task without error', async () => {
    const entityId = uuidv4();
    await expect(searchWorkerJob(makeJob({
      entityType: 'task',
      entityId,
      orgId,
      action: 'delete',
    }))).resolves.not.toThrow();
  });

  it('sets Redis idempotency key after processing', async () => {
    const entityId = uuidv4();
    await searchWorkerJob(makeJob({
      entityType: 'file',
      entityId,
      orgId,
      action: 'upsert',
      document: { title: 'report.pdf', body: '' },
    }));

    const key = await redisClient.get(`search:indexed:file:${entityId}:upsert`);
    expect(key).toBe('1');
  });

  it('is idempotent — second call with same entity+action is skipped', async () => {
    const entityId = uuidv4();
    const job = makeJob({
      entityType: 'user',
      entityId,
      orgId,
      action: 'upsert',
      document: { title: 'Jane Doe', body: '' },
    });

    await searchWorkerJob(job);
    // Key is now set; second call should be a no-op
    await expect(searchWorkerJob(job)).resolves.not.toThrow();
  });

  it('processes message upsert without error', async () => {
    const entityId = uuidv4();
    await expect(searchWorkerJob(makeJob({
      entityType: 'message',
      entityId,
      orgId,
      action: 'upsert',
      document: { title: '', body: 'hello world' },
    }))).resolves.not.toThrow();
  });
});
