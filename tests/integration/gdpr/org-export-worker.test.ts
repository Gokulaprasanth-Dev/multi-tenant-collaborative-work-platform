/**
 * Integration tests for gdpr/workers/org-export.worker.ts SQL queries
 *
 * Validates that the three entity SQL queries (workspaces, tasks, members)
 * execute without error against the live DB.
 * Mirrors the user-export-worker pattern.
 */

import { seedUser, seedOrg } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('org-export SQL query validation', () => {
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const u = await seedUser();
    userId = u.userId;
    const o = await seedOrg({ ownerId: userId });
    orgId = o.orgId;
  });

  it('workspaces SQL query succeeds', async () => {
    await expect(
      queryPrimary(
        `SELECT id, name, created_at FROM workspaces WHERE org_id = $1 AND deleted_at IS NULL LIMIT 100 OFFSET 0`,
        [orgId]
      )
    ).resolves.toBeDefined();
  });

  it('tasks SQL query succeeds', async () => {
    await expect(
      queryPrimary(
        `SELECT id, title, status, created_at FROM tasks WHERE org_id = $1 AND deleted_at IS NULL LIMIT 100 OFFSET 0`,
        [orgId]
      )
    ).resolves.toBeDefined();
  });

  it('members SQL query succeeds', async () => {
    await expect(
      queryPrimary(
        `SELECT user_id, role, joined_at FROM org_memberships WHERE org_id = $1 AND status = 'active' AND deleted_at IS NULL LIMIT 100 OFFSET 0`,
        [orgId]
      )
    ).resolves.toBeDefined();
  });

  it('members query returns at least the owner', async () => {
    const result = await queryPrimary<{ user_id: string; role: string }>(
      `SELECT user_id, role, joined_at FROM org_memberships WHERE org_id = $1 AND status = 'active' AND deleted_at IS NULL LIMIT 100 OFFSET 0`,
      [orgId]
    );
    const memberIds = result.rows.map(r => r.user_id);
    expect(memberIds).toContain(userId);
  });

  it('tasks query returns seeded task after insert', async () => {
    const wsResult = await queryPrimary<{ id: string }>(
      `SELECT id FROM workspaces WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );
    const workspaceId = wsResult.rows[0]?.id;
    if (!workspaceId) return;

    await queryPrimary(
      `INSERT INTO tasks (org_id, workspace_id, title, creator_id) VALUES ($1, $2, 'Org Export Test Task', $3)`,
      [orgId, workspaceId, userId]
    );

    const result = await queryPrimary<{ title: string }>(
      `SELECT id, title, status, created_at FROM tasks WHERE org_id = $1 AND deleted_at IS NULL LIMIT 100 OFFSET 0`,
      [orgId]
    );
    expect(result.rows.some(r => r.title === 'Org Export Test Task')).toBe(true);
  });
});
