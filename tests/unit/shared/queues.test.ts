/**
 * Unit tests for src/shared/queue/queues.ts
 *
 * Covers:
 * - queues object contains all expected queue names
 * - enqueue: calls queue.add with correct job name and data
 * - enqueue: merges _traceContext into the job data
 * - enqueue: passes through optional job options to queue.add
 * - enqueue: throws on unknown queue name (TypeScript guard, skipped at runtime)
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
  })),
}));

jest.mock('../../../src/shared/redis/clients', () => ({
  redisClient: { connection: {} },
}));

// Mock OpenTelemetry propagation — inject empty trace context
jest.mock('@opentelemetry/api', () => ({
  context: { active: jest.fn().mockReturnValue({}) },
  propagation: { inject: jest.fn() },
}));

import { queues, enqueue } from '../../../src/shared/queue/queues';

beforeEach(() => {
  jest.clearAllMocks();
  mockQueueAdd.mockResolvedValue({ id: 'job-1' });
});

describe('queues', () => {
  const expectedQueues = [
    'notifications', 'emails', 'webhooks', 'search', 'audit',
    'cleanup', 'exports', 'payments', 'recurring-tasks', 'virus-scan',
    'erase-user', 'offboarding', 'gdpr-export', 'gdpr-org-export',
  ];

  it.each(expectedQueues)('contains queue "%s"', (name) => {
    expect(queues).toHaveProperty(name);
  });
});

describe('enqueue', () => {
  it('calls queue.add with the correct job name and data', async () => {
    await enqueue('notifications', 'send-notification', { userId: 'user-1' });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({ userId: 'user-1' }),
      undefined
    );
  });

  it('merges _traceContext into the job data', async () => {
    await enqueue('emails', 'send-email', { to: 'a@b.com' });
    const callArgs = mockQueueAdd.mock.calls[0];
    expect(callArgs[1]).toHaveProperty('_traceContext');
  });

  it('passes optional job options to queue.add', async () => {
    const opts = { delay: 5000, priority: 1 };
    await enqueue('webhooks', 'deliver', { url: 'https://x.com' }, opts);
    const callArgs = mockQueueAdd.mock.calls[0];
    expect(callArgs[2]).toEqual(opts);
  });

  it('preserves original data fields alongside _traceContext', async () => {
    await enqueue('audit', 'log-event', { orgId: 'org-1', event: 'login' });
    const callArgs = mockQueueAdd.mock.calls[0];
    expect(callArgs[1]).toMatchObject({ orgId: 'org-1', event: 'login' });
    expect(callArgs[1]).toHaveProperty('_traceContext');
  });

  it('resolves without error for all known queues', async () => {
    const queueNames = Object.keys(queues) as Array<keyof typeof queues>;
    for (const name of queueNames) {
      await expect(enqueue(name, 'test-job', {})).resolves.toBeUndefined();
    }
  });
});
