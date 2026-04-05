/**
 * Unit tests for src/modules/task/dependency.service.ts
 *
 * Covers:
 * - addDependency: throws SELF_DEPENDENCY when blockingTaskId === blockedTaskId
 * - addDependency: throws NOT_FOUND when blocking task not found
 * - addDependency: throws NOT_FOUND when blocked task not found
 * - addDependency: throws CROSS_WORKSPACE_DEPENDENCY when tasks are in different workspaces
 * - addDependency: throws DEPENDENCY_CYCLE when cycle would be created
 * - addDependency: inserts and returns the dependency when valid
 * - removeDependency: delegates to taskRepo.deleteDependency
 * - listDependencies: delegates to taskRepo.findDependencies
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const mockFindById = jest.fn();
const mockInsertDependency = jest.fn();
const mockDeleteDependency = jest.fn();
const mockFindDependencies = jest.fn();

jest.mock('../../../src/modules/task/task.repository', () => ({
  TaskRepository: jest.fn().mockImplementation(() => ({
    findById: mockFindById,
    insertDependency: mockInsertDependency,
    deleteDependency: mockDeleteDependency,
    findDependencies: mockFindDependencies,
  })),
}));

const mockQueryPrimary = jest.fn();
jest.mock('../../../src/shared/database/pool', () => ({
  queryPrimary: (...args: unknown[]) => mockQueryPrimary(...args),
  queryReplica: jest.fn(),
}));

import { addDependency, removeDependency, listDependencies } from '../../../src/modules/task/dependency.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTask(id: string, workspaceId = 'ws-1', orgId = 'org-1') {
  return { id, org_id: orgId, workspace_id: workspaceId };
}

function makeDep(id = 'dep-1') {
  return { id, org_id: 'org-1', blocking_task_id: 'task-A', blocked_task_id: 'task-B', created_by: 'user-1', created_at: new Date() };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no existing dependencies (no cycle)
  mockQueryPrimary.mockResolvedValue({ rows: [] });
});

// ── addDependency ─────────────────────────────────────────────────────────────

describe('addDependency', () => {
  const orgId = 'org-1';
  const userId = 'user-1';

  it('throws SELF_DEPENDENCY when blockingTaskId === blockedTaskId', async () => {
    await expect(addDependency(orgId, 'task-A', 'task-A', userId))
      .rejects.toMatchObject({ code: 'SELF_DEPENDENCY' });
  });

  it('throws NOT_FOUND when blocking task does not exist', async () => {
    mockFindById.mockResolvedValueOnce(null).mockResolvedValueOnce(makeTask('task-B'));
    await expect(addDependency(orgId, 'task-A', 'task-B', userId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND when blocking task belongs to a different org', async () => {
    mockFindById
      .mockResolvedValueOnce(makeTask('task-A', 'ws-1', 'org-OTHER'))
      .mockResolvedValueOnce(makeTask('task-B', 'ws-1', orgId));
    await expect(addDependency(orgId, 'task-A', 'task-B', userId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND when blocked task does not exist', async () => {
    mockFindById.mockResolvedValueOnce(makeTask('task-A')).mockResolvedValueOnce(null);
    await expect(addDependency(orgId, 'task-A', 'task-B', userId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws CROSS_WORKSPACE_DEPENDENCY when tasks are in different workspaces', async () => {
    mockFindById
      .mockResolvedValueOnce(makeTask('task-A', 'ws-1'))
      .mockResolvedValueOnce(makeTask('task-B', 'ws-2'));
    await expect(addDependency(orgId, 'task-A', 'task-B', userId))
      .rejects.toMatchObject({ code: 'CROSS_WORKSPACE_DEPENDENCY' });
  });

  it('throws DEPENDENCY_CYCLE when cycle would be created', async () => {
    // task-A blocks task-B, task-B already blocks task-A → cycle
    // DFS: starting from task-B (blockedTaskId), find what task-B blocks
    mockFindById
      .mockResolvedValueOnce(makeTask('task-A'))
      .mockResolvedValueOnce(makeTask('task-B'));
    // DFS query: blocked_task_id FROM task_dependencies WHERE blocking_task_id = task-B → returns task-A
    mockQueryPrimary.mockResolvedValueOnce({ rows: [{ blocked_task_id: 'task-A' }] });
    await expect(addDependency(orgId, 'task-A', 'task-B', userId))
      .rejects.toMatchObject({ code: 'DEPENDENCY_CYCLE' });
  });

  it('inserts and returns dependency when valid', async () => {
    const dep = makeDep();
    mockFindById
      .mockResolvedValueOnce(makeTask('task-A'))
      .mockResolvedValueOnce(makeTask('task-B'));
    mockQueryPrimary.mockResolvedValueOnce({ rows: [] }); // no cycle
    mockInsertDependency.mockResolvedValue(dep);

    const result = await addDependency(orgId, 'task-A', 'task-B', userId);
    expect(result).toEqual(dep);
    expect(mockInsertDependency).toHaveBeenCalledWith(orgId, 'task-A', 'task-B', userId);
  });
});

// ── removeDependency ──────────────────────────────────────────────────────────

describe('removeDependency', () => {
  it('calls taskRepo.deleteDependency', async () => {
    mockDeleteDependency.mockResolvedValue(undefined);
    await removeDependency('org-1', 'dep-1');
    expect(mockDeleteDependency).toHaveBeenCalledWith('org-1', 'dep-1');
  });
});

// ── listDependencies ──────────────────────────────────────────────────────────

describe('listDependencies', () => {
  it('returns dependencies from taskRepo.findDependencies', async () => {
    const deps = [makeDep('dep-1'), makeDep('dep-2')];
    mockFindDependencies.mockResolvedValue(deps);
    const result = await listDependencies('org-1', 'task-A');
    expect(result).toEqual(deps);
    expect(mockFindDependencies).toHaveBeenCalledWith('org-1', 'task-A');
  });
});
