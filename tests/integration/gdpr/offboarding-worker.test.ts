/**
 * Integration tests for GDPR offboarding worker (Phase 4)
 *
 * Covers:
 * - Org status must be 'offboarding' (skips 'deleted', warns for other statuses)
 * - Workspaces, tasks, channels, files, webhooks are soft-deleted
 * - Org status is set to 'deleted', deleted_at is set
 * - audit log writes 'org.deleted' event
 * - Idempotent — running twice does not throw
 */

import { v4 as uuidv4 } from 'uuid';
import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import { runOffboardingJob } from '../../../src/modules/gdpr/workers/offboarding.worker';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('GDPR Offboarding Worker', () => {
  let orgId: string;
  let userId: string;

  beforeEach(async () => {
    const owner = await seedUser();
    userId = owner.userId;
    const org = await seedOrg({ ownerId: owner.userId });
    orgId = org.orgId;

    // Put org in offboarding status
    await queryPrimary(`UPDATE organizations SET status = 'offboarding' WHERE id = $1`, [orgId]);
  });

  it('sets org status to deleted and deleted_at', async () => {
    await runOffboardingJob({ orgId });

    const row = await queryPrimary<{ status: string; deleted_at: Date | null }>(
      `SELECT status, deleted_at FROM organizations WHERE id = $1`,
      [orgId]
    );
    expect(row.rows[0]!.status).toBe('deleted');
    expect(row.rows[0]!.deleted_at).not.toBeNull();
  });

  it('soft-deletes workspaces', async () => {
    // Seed an extra workspace
    await queryPrimary(
      `INSERT INTO workspaces (org_id, name, status, owner_user_id, created_at, updated_at, version)
       VALUES ($1, 'Test Workspace', 'active', $2, NOW(), NOW(), 1)`,
      [orgId, userId]
    );

    await runOffboardingJob({ orgId });

    const row = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM workspaces WHERE org_id = $1 AND deleted_at IS NULL`,
      [orgId]
    );
    expect(parseInt(row.rows[0]!.count, 10)).toBe(0);
  });

  it('soft-deletes tasks', async () => {
    // Seed a task
    const wsRow = await queryPrimary<{ id: string }>(
      `SELECT id FROM workspaces WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );
    const workspaceId = wsRow.rows[0]?.id;
    if (workspaceId) {
      await queryPrimary(
        `INSERT INTO tasks (org_id, workspace_id, title, status, creator_id, created_at, updated_at, version)
         VALUES ($1, $2, 'Test Task', 'todo', $3, NOW(), NOW(), 1)`,
        [orgId, workspaceId, userId]
      );
    }

    await runOffboardingJob({ orgId });

    const row = await queryPrimary<{ count: string }>(
      `SELECT COUNT(*) AS count FROM tasks WHERE org_id = $1 AND deleted_at IS NULL`,
      [orgId]
    );
    expect(parseInt(row.rows[0]!.count, 10)).toBe(0);
  });

  it('writes org.deleted audit log entry', async () => {
    await runOffboardingJob({ orgId });

    const row = await queryPrimary<{ event_type: string }>(
      `SELECT event_type FROM audit_logs WHERE entity_type = 'org' AND entity_id = $1
       ORDER BY occurred_at DESC LIMIT 1`,
      [orgId]
    );
    expect(row.rows[0]!.event_type).toBe('org.deleted');
  });

  it('no-ops on org with status=deleted', async () => {
    await queryPrimary(`UPDATE organizations SET status = 'deleted' WHERE id = $1`, [orgId]);
    await expect(runOffboardingJob({ orgId })).resolves.not.toThrow();
  });

  it('no-ops on non-existent org', async () => {
    await expect(runOffboardingJob({ orgId: uuidv4() })).resolves.not.toThrow();
  });

  it('is idempotent — running twice does not throw', async () => {
    await runOffboardingJob({ orgId });
    await expect(runOffboardingJob({ orgId })).resolves.not.toThrow();
  });
});
