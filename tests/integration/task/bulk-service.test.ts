/**
 * Integration tests for task/bulk.service.ts
 * Requires DATABASE_URL env var.
 * Run: npm run migrate:test && npm run test:integration
 */

import { v4 as uuidv4 } from 'uuid';
import { bulkUpdateStatus, bulkDelete } from '../../../src/modules/task/bulk.service';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import { ForbiddenError, AppError } from '../../../src/shared/errors/app-errors';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('bulkUpdateStatus / bulkDelete integration', () => {
  let ownerId: string;
  let orgId: string;
  let workspaceId: string;
  let taskIds: string[];

  // Member user (role='member') — used for permission tests
  let memberId: string;

  beforeAll(async () => {
    // Seed owner and org
    const owner = await seedUser();
    ownerId = owner.userId;
    const org = await seedOrg({ ownerId });
    orgId = org.orgId;

    // Retrieve the default workspace created by seedOrg
    const wsResult = await queryPrimary<{ id: string }>(
      `SELECT id FROM workspaces WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );
    workspaceId = wsResult.rows[0]!.id;

    // Seed a member user and add to org with role='member'
    const member = await seedUser();
    memberId = member.userId;
    await queryPrimary(
      `INSERT INTO org_memberships (org_id, user_id, role, status, joined_at, created_at, updated_at)
       VALUES ($1, $2, 'member', 'active', NOW(), NOW(), NOW())`,
      [orgId, memberId]
    );

    // Seed 3 tasks
    taskIds = [];
    for (let i = 0; i < 3; i++) {
      const taskResult = await queryPrimary<{ id: string }>(
        `INSERT INTO tasks (org_id, workspace_id, title, status, priority, creator_id, created_at, updated_at, version)
         VALUES ($1, $2, $3, 'todo', 'medium', $4, NOW(), NOW(), 1)
         RETURNING id`,
        [orgId, workspaceId, `Bulk Task ${i + 1}`, ownerId]
      );
      taskIds.push(taskResult.rows[0]!.id);
    }
  });

  afterAll(async () => {
    // Clean up tasks and seeded data
    if (taskIds && taskIds.length > 0) {
      await queryPrimary(
        `DELETE FROM tasks WHERE id = ANY($1)`,
        [taskIds]
      );
    }
  });

  // ── bulkUpdateStatus ──────────────────────────────────────────────────────

  describe('bulkUpdateStatus', () => {
    it('updates tasks to in_progress for admin user', async () => {
      await bulkUpdateStatus(orgId, ownerId, { taskIds, status: 'in_progress' });

      const result = await queryPrimary<{ status: string }>(
        `SELECT status FROM tasks WHERE id = ANY($1)`,
        [taskIds]
      );

      for (const row of result.rows) {
        expect(row.status).toBe('in_progress');
      }
    });

    it('returns { updated: N } with correct count', async () => {
      // Reset tasks back to todo first
      await queryPrimary(
        `UPDATE tasks SET status = 'todo' WHERE id = ANY($1)`,
        [taskIds]
      );

      const result = await bulkUpdateStatus(orgId, ownerId, { taskIds, status: 'in_progress' });

      expect(result).toEqual({ updated: taskIds.length });
    });

    it('throws ForbiddenError with code INSUFFICIENT_ROLE for a member user', async () => {
      const err = await bulkUpdateStatus(orgId, memberId, {
        taskIds,
        status: 'done',
      }).catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.code).toBe('INSUFFICIENT_ROLE');
    });

    it('throws AppError with code BULK_SIZE_INVALID for empty array', async () => {
      const err = await bulkUpdateStatus(orgId, ownerId, {
        taskIds: [],
        status: 'done',
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('BULK_SIZE_INVALID');
    });

    it('throws AppError with code BULK_SIZE_INVALID for > 100 task IDs', async () => {
      const fakeIds = Array.from({ length: 101 }, () => uuidv4());

      const err = await bulkUpdateStatus(orgId, ownerId, {
        taskIds: fakeIds,
        status: 'done',
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('BULK_SIZE_INVALID');
    });
  });

  // ── bulkDelete ────────────────────────────────────────────────────────────

  describe('bulkDelete', () => {
    it('soft-deletes tasks (deleted_at IS NOT NULL)', async () => {
      // Reset deleted_at to NULL before testing
      await queryPrimary(
        `UPDATE tasks SET deleted_at = NULL WHERE id = ANY($1)`,
        [taskIds]
      );

      await bulkDelete(orgId, ownerId, { taskIds });

      const result = await queryPrimary<{ deleted_at: Date | null }>(
        `SELECT deleted_at FROM tasks WHERE id = ANY($1)`,
        [taskIds]
      );

      for (const row of result.rows) {
        expect(row.deleted_at).not.toBeNull();
      }
    });

    it('returns { deleted: N }', async () => {
      // Reset deleted_at so the soft-delete can apply again
      await queryPrimary(
        `UPDATE tasks SET deleted_at = NULL WHERE id = ANY($1)`,
        [taskIds]
      );

      const result = await bulkDelete(orgId, ownerId, { taskIds });

      expect(result).toEqual({ deleted: taskIds.length });
    });
  });
});
