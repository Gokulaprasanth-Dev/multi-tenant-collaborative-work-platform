/**
 * Unit tests for src/shared/queue/dlq.ts
 *
 * Covers:
 * - getDlqJobs returns failed jobs from the specified queue
 * - getDlqJobs calls getFailed on the correct queue only
 * - requeueDlqJob calls job.retry('failed') for a found job
 * - requeueDlqJob throws Error when job is not found
 */

// Mock the BullMQ queues module so we control getFailed / getJob
jest.mock('../../../src/shared/queue/queues', () => ({
  queues: {
    payments: {
      getFailed: jest.fn(),
      getJob: jest.fn(),
    },
    emails: {
      getFailed: jest.fn(),
      getJob: jest.fn(),
    },
  },
}));

// Stub redis/clients — queues.ts imports redisClient at module level
jest.mock('../../../src/shared/redis/clients', () => ({
  redisClient: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    duplicate: jest.fn(),
    quit: jest.fn(),
  },
}));

// Stub config in case any transitive import needs it
jest.mock('../../../src/shared/config', () => ({
  config: {
    encryptionKey: 'a'.repeat(64),
    jwtPrivateKey: '',
    jwtPublicKey: '',
    inviteSecret: 'x'.repeat(32),
    metricsToken: 'x'.repeat(16),
  },
}));

import { getDlqJobs, requeueDlqJob } from '../../../src/shared/queue/dlq';

// Pull the mock references out of the mocked module
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { queues } = jest.requireMock('../../../src/shared/queue/queues') as {
  queues: {
    payments: { getFailed: jest.Mock; getJob: jest.Mock };
    emails: { getFailed: jest.Mock; getJob: jest.Mock };
  };
};

describe('getDlqJobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns failed jobs from the specified queue', async () => {
    const fakJobs = [{ id: 'job-1' }, { id: 'job-2' }];
    queues.payments.getFailed.mockResolvedValue(fakJobs);

    const result = await getDlqJobs('payments');

    expect(result).toEqual(fakJobs);
    expect(queues.payments.getFailed).toHaveBeenCalledTimes(1);
  });

  it('calls getFailed on the correct queue and not on another queue', async () => {
    queues.emails.getFailed.mockResolvedValue([{ id: 'email-job-1' }]);

    await getDlqJobs('emails');

    expect(queues.emails.getFailed).toHaveBeenCalledTimes(1);
    expect(queues.payments.getFailed).not.toHaveBeenCalled();
  });
});

describe('requeueDlqJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls job.retry("failed") for a found job', async () => {
    const mockRetry = jest.fn().mockResolvedValue(undefined);
    const fakeJob = { id: 'job-99', retry: mockRetry };
    queues.payments.getJob.mockResolvedValue(fakeJob);

    await requeueDlqJob('payments', 'job-99');

    expect(queues.payments.getJob).toHaveBeenCalledWith('job-99');
    expect(mockRetry).toHaveBeenCalledWith('failed');
  });

  it('throws an Error when getJob returns null', async () => {
    queues.payments.getJob.mockResolvedValue(null);

    await expect(requeueDlqJob('payments', 'nonexistent')).rejects.toThrow(
      'Job nonexistent not found in queue payments'
    );
  });

  it('throws an Error when getJob returns undefined', async () => {
    queues.payments.getJob.mockResolvedValue(undefined);

    await expect(requeueDlqJob('payments', 'ghost-job')).rejects.toThrow(
      'Job ghost-job not found in queue payments'
    );
  });
});
