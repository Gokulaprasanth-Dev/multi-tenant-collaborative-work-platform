/**
 * Unit tests for src/modules/task/template.service.ts
 *
 * Covers:
 * - createTemplate: throws INSUFFICIENT_ROLE for non-admin/non-owner users
 * - createTemplate: inserts and returns template for admin users
 * - createTemplate: uses null defaults for optional fields
 * - listTemplates: returns all active templates for the org
 * - getTemplate: returns a single template by id
 * - getTemplate: throws NOT_FOUND when template does not exist
 * - deleteTemplate: throws INSUFFICIENT_ROLE for non-admin/non-owner users
 * - deleteTemplate: soft-deletes the template
 * - deleteTemplate: throws NOT_FOUND when template does not exist
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const mockFindMembership = jest.fn();

jest.mock('../../../src/modules/organization/repositories/membership.repository', () => ({
  MembershipRepository: jest.fn().mockImplementation(() => ({
    findMembership: mockFindMembership,
  })),
}));

const mockQueryPrimary = jest.fn();
const mockQueryReplica = jest.fn();

jest.mock('../../../src/shared/database/pool', () => ({
  queryPrimary: (...args: unknown[]) => mockQueryPrimary(...args),
  queryReplica: (...args: unknown[]) => mockQueryReplica(...args),
}));

import {
  createTemplate,
  listTemplates,
  getTemplate,
  deleteTemplate,
} from '../../../src/modules/task/template.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTemplate(id = 'tpl-1') {
  return {
    id,
    org_id: 'org-1',
    name: 'Bug Template',
    default_title: 'Bug: ',
    default_description: null,
    default_priority: 'medium' as const,
    default_labels: ['bug'],
    created_by: 'user-1',
    deleted_at: null,
    created_at: new Date(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryPrimary.mockResolvedValue({ rows: [] });
  mockQueryReplica.mockResolvedValue({ rows: [] });
});

// ── createTemplate ────────────────────────────────────────────────────────────

describe('createTemplate', () => {
  it('throws INSUFFICIENT_ROLE when user is a plain member', async () => {
    mockFindMembership.mockResolvedValue({ role: 'member' });
    await expect(
      createTemplate('org-1', 'user-1', { name: 'T1' })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_ROLE' });
  });

  it('throws INSUFFICIENT_ROLE when membership is null', async () => {
    mockFindMembership.mockResolvedValue(null);
    await expect(
      createTemplate('org-1', 'user-1', { name: 'T1' })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_ROLE' });
  });

  it('inserts template and returns result for org_admin', async () => {
    mockFindMembership.mockResolvedValue({ role: 'org_admin' });
    const tpl = makeTemplate();
    mockQueryPrimary.mockResolvedValue({ rows: [tpl] });

    const result = await createTemplate('org-1', 'user-1', {
      name: 'Bug Template',
      default_title: 'Bug: ',
      default_priority: 'medium',
      default_labels: ['bug'],
    });

    expect(mockQueryPrimary).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO task_templates'),
      expect.arrayContaining(['org-1', 'Bug Template'])
    );
    expect(result).toEqual(tpl);
  });

  it('inserts template for org_owner', async () => {
    mockFindMembership.mockResolvedValue({ role: 'org_owner' });
    mockQueryPrimary.mockResolvedValue({ rows: [makeTemplate()] });
    await expect(createTemplate('org-1', 'user-1', { name: 'T' })).resolves.toBeDefined();
  });

  it('uses null for optional fields when not provided', async () => {
    mockFindMembership.mockResolvedValue({ role: 'org_admin' });
    mockQueryPrimary.mockResolvedValue({ rows: [makeTemplate()] });

    await createTemplate('org-1', 'user-1', { name: 'MinimalTemplate' });

    const params = mockQueryPrimary.mock.calls[0][1];
    expect(params[2]).toBeNull(); // default_title
    expect(params[3]).toBeNull(); // default_description
    expect(params[4]).toBeNull(); // default_priority
  });
});

// ── listTemplates ─────────────────────────────────────────────────────────────

describe('listTemplates', () => {
  it('returns all active templates for the org', async () => {
    const templates = [makeTemplate('tpl-1'), makeTemplate('tpl-2')];
    mockQueryReplica.mockResolvedValue({ rows: templates });

    const result = await listTemplates('org-1');

    expect(mockQueryReplica).toHaveBeenCalledWith(
      expect.stringContaining('WHERE org_id = $1 AND deleted_at IS NULL'),
      ['org-1']
    );
    expect(result).toEqual(templates);
  });

  it('returns empty array when no templates exist', async () => {
    mockQueryReplica.mockResolvedValue({ rows: [] });
    const result = await listTemplates('org-1');
    expect(result).toEqual([]);
  });
});

// ── getTemplate ───────────────────────────────────────────────────────────────

describe('getTemplate', () => {
  it('returns the template when found', async () => {
    const tpl = makeTemplate();
    mockQueryReplica.mockResolvedValue({ rows: [tpl] });

    const result = await getTemplate('org-1', 'tpl-1');
    expect(result).toEqual(tpl);
    expect(mockQueryReplica).toHaveBeenCalledWith(
      expect.any(String),
      ['tpl-1', 'org-1']
    );
  });

  it('throws NOT_FOUND when template does not exist', async () => {
    mockQueryReplica.mockResolvedValue({ rows: [] });
    await expect(getTemplate('org-1', 'tpl-missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

// ── deleteTemplate ────────────────────────────────────────────────────────────

describe('deleteTemplate', () => {
  it('throws INSUFFICIENT_ROLE for plain member', async () => {
    mockFindMembership.mockResolvedValue({ role: 'member' });
    await expect(deleteTemplate('org-1', 'tpl-1', 'user-1')).rejects.toMatchObject({
      code: 'INSUFFICIENT_ROLE',
    });
  });

  it('soft-deletes the template for org_admin', async () => {
    mockFindMembership.mockResolvedValue({ role: 'org_admin' });
    mockQueryPrimary.mockResolvedValue({ rows: [{ id: 'tpl-1' }] });

    await deleteTemplate('org-1', 'tpl-1', 'user-1');

    expect(mockQueryPrimary).toHaveBeenCalledWith(
      expect.stringContaining('SET deleted_at = NOW()'),
      ['tpl-1', 'org-1']
    );
  });

  it('throws NOT_FOUND when template does not exist', async () => {
    mockFindMembership.mockResolvedValue({ role: 'org_admin' });
    mockQueryPrimary.mockResolvedValue({ rows: [] }); // not found

    await expect(deleteTemplate('org-1', 'tpl-missing', 'user-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
