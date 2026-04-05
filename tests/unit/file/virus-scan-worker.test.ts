/**
 * Unit tests for src/modules/file/workers/virus-scan.worker.ts
 *
 * Covers:
 * - virusScanWorkerJob: when virusScanEnabled=false, marks file clean immediately
 * - virusScanWorkerJob: skips when storageUrl is missing and scanning enabled
 * - fileCleanupWorkerJob: soft-deletes stale pending files and reclaims quota
 * - fileCleanupWorkerJob: no-op when no stale files
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const mockQueryPrimary = jest.fn();
jest.mock('../../../src/shared/database/pool', () => ({
  queryPrimary: (...args: unknown[]) => mockQueryPrimary(...args),
}));

jest.mock('../../../src/shared/redis/clients', () => ({
  redisClient: { connection: {} },
}));

// Config mock — inline to avoid temporal dead zone with jest.mock hoisting
jest.mock('../../../src/shared/config', () => ({
  config: {
    virusScanEnabled: false,
    clamavHost: 'localhost',
    clamavPort: 3310,
    awsS3Bucket: undefined,
    logLevel: 'info',
    nodeEnv: 'test',
  },
}));

const mockFindStalePending = jest.fn();
const mockSoftDelete = jest.fn();
jest.mock('../../../src/modules/file/file.repository', () => ({
  FileRepository: jest.fn().mockImplementation(() => ({
    findStalePending: mockFindStalePending,
    softDelete: mockSoftDelete,
  })),
}));

// Mock bullmq Worker to prevent real Redis connections
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
  })),
}));

import { virusScanWorkerJob, fileCleanupWorkerJob } from '../../../src/modules/file/workers/virus-scan.worker';
import { Job } from 'bullmq';
import { config } from '../../../src/shared/config';

function makeJob(data: object): Job {
  return { data, id: 'job-1' } as unknown as Job;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryPrimary.mockResolvedValue({ rows: [] });
  mockFindStalePending.mockResolvedValue([]);
  mockSoftDelete.mockResolvedValue(undefined);
  // Reset virusScanEnabled to false between tests
  (config as any).virusScanEnabled = false;
});

// ── virusScanWorkerJob ────────────────────────────────────────────────────────

describe('virusScanWorkerJob', () => {
  it('marks file as clean immediately when virusScanEnabled=false', async () => {
    (config as any).virusScanEnabled = false;
    const job = makeJob({ fileId: 'file-1', storageKey: 'key-1', orgId: 'org-1' });
    await virusScanWorkerJob(job as Job);
    expect(mockQueryPrimary).toHaveBeenCalledWith(
      expect.stringContaining("scan_status = 'clean'"),
      ['file-1']
    );
  });

  it('skips without error when storageUrl is missing and scanning enabled', async () => {
    (config as any).virusScanEnabled = true;
    const job = makeJob({ fileId: 'file-1', storageKey: 'key-1', orgId: 'org-1' });
    // Should not throw — just warn and return without updating scan_status
    await expect(virusScanWorkerJob(job as Job)).resolves.toBeUndefined();
    expect(mockQueryPrimary).not.toHaveBeenCalledWith(
      expect.stringContaining("scan_status = 'clean'"),
      expect.anything()
    );
  });
});

// ── fileCleanupWorkerJob ──────────────────────────────────────────────────────

describe('fileCleanupWorkerJob', () => {
  it('no-op when no stale pending files', async () => {
    mockFindStalePending.mockResolvedValue([]);
    const job = makeJob({});
    await fileCleanupWorkerJob(job as Job);
    expect(mockSoftDelete).not.toHaveBeenCalled();
    expect(mockQueryPrimary).not.toHaveBeenCalled();
  });

  it('reclaims quota and soft-deletes each stale file', async () => {
    const staleFiles = [
      { id: 'file-1', size_bytes: 1024, org_id: 'org-1' },
      { id: 'file-2', size_bytes: 2048, org_id: 'org-1' },
    ];
    mockFindStalePending.mockResolvedValue(staleFiles);

    const job = makeJob({});
    await fileCleanupWorkerJob(job as Job);

    // Quota reclaim called for each file
    expect(mockQueryPrimary).toHaveBeenCalledTimes(2);
    expect(mockQueryPrimary).toHaveBeenCalledWith(
      expect.stringContaining('storage_used_bytes'),
      [1024, 'org-1']
    );
    expect(mockQueryPrimary).toHaveBeenCalledWith(
      expect.stringContaining('storage_used_bytes'),
      [2048, 'org-1']
    );

    // Soft-delete called for each file
    expect(mockSoftDelete).toHaveBeenCalledTimes(2);
    expect(mockSoftDelete).toHaveBeenCalledWith('file-1');
    expect(mockSoftDelete).toHaveBeenCalledWith('file-2');
  });
});
