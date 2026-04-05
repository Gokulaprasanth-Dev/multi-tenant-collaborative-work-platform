/**
 * Unit tests for src/modules/task/activity-log.service.ts
 *
 * Covers:
 * - log: inserts into task_activity_log with correct params
 * - log: serialises payload as jsonb
 * - log: uses empty object as default payload
 * - listForTask: queries by orgId and taskId, orders ASC
 * - listForOrg: queries by orgId, orders DESC, respects limit/offset
 * - listForOrg: uses default limit=100 and offset=0
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const mockQueryPrimary = jest.fn();
const mockQueryReplica = jest.fn();

jest.mock('../../../src/shared/database/pool', () => ({
  queryPrimary: (...args: unknown[]) => mockQueryPrimary(...args),
  queryReplica: (...args: unknown[]) => mockQueryReplica(...args),
}));

import { log, listForTask, listForOrg } from '../../../src/modules/task/activity-log.service';

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryPrimary.mockResolvedValue({ rows: [] });
  mockQueryReplica.mockResolvedValue({ rows: [] });
});

describe('log', () => {
  it('inserts into task_activity_log with correct params', async () => {
    await log('org-1', 'user-1', 'task.created', 'task-1', { title: 'Test' });
    expect(mockQueryPrimary).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO task_activity_log'),
      ['org-1', 'task-1', 'user-1', 'task.created', JSON.stringify({ title: 'Test' })]
    );
  });

  it('uses empty object as default payload when not provided', async () => {
    await log('org-1', 'user-1', 'task.updated', 'task-1');
    expect(mockQueryPrimary).toHaveBeenCalledWith(
      expect.any(String),
      ['org-1', 'task-1', 'user-1', 'task.updated', JSON.stringify({})]
    );
  });

  it('serialises complex payload to JSON string', async () => {
    const payload = { before: { status: 'todo' }, after: { status: 'done' } };
    await log('org-1', 'user-1', 'task.status_changed', 'task-1', payload);
    const params = mockQueryPrimary.mock.calls[0][1];
    expect(params[4]).toBe(JSON.stringify(payload));
  });
});

describe('listForTask', () => {
  it('queries task_activity_log by orgId and taskId', async () => {
    const rows = [{ id: 'log-1', event_type: 'task.created' }];
    mockQueryReplica.mockResolvedValue({ rows });
    const result = await listForTask('org-1', 'task-1');
    expect(mockQueryReplica).toHaveBeenCalledWith(
      expect.stringContaining('WHERE org_id = $1 AND task_id = $2'),
      ['org-1', 'task-1']
    );
    expect(result).toEqual(rows);
  });

  it('orders results ASC', async () => {
    await listForTask('org-1', 'task-1');
    const sql = mockQueryReplica.mock.calls[0][0] as string;
    expect(sql).toMatch(/ORDER BY created_at ASC/i);
  });

  it('returns empty array when no logs exist', async () => {
    mockQueryReplica.mockResolvedValue({ rows: [] });
    const result = await listForTask('org-1', 'task-x');
    expect(result).toEqual([]);
  });
});

describe('listForOrg', () => {
  it('queries task_activity_log by orgId with default limit and offset', async () => {
    const rows = [{ id: 'log-2', event_type: 'task.deleted' }];
    mockQueryReplica.mockResolvedValue({ rows });
    const result = await listForOrg('org-1');
    expect(mockQueryReplica).toHaveBeenCalledWith(
      expect.stringContaining('WHERE org_id = $1'),
      ['org-1', 100, 0]
    );
    expect(result).toEqual(rows);
  });

  it('passes custom limit and offset', async () => {
    await listForOrg('org-1', 20, 40);
    expect(mockQueryReplica).toHaveBeenCalledWith(
      expect.any(String),
      ['org-1', 20, 40]
    );
  });

  it('orders results DESC', async () => {
    await listForOrg('org-1');
    const sql = mockQueryReplica.mock.calls[0][0] as string;
    expect(sql).toMatch(/ORDER BY created_at DESC/i);
  });
});
