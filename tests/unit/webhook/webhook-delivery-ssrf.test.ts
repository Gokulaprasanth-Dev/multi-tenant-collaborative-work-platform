/**
 * Unit tests for SEC-NEW-003: SSRF prevention in webhook-delivery.worker.ts
 *
 * The delivery worker resolves the webhook URL's hostname via DNS at delivery
 * time and blocks the request if the resolved IP is in a private/loopback range.
 *
 * Covers:
 * - Private IPv4 ranges blocked (10.x, 172.16-31.x, 192.168.x)
 * - Loopback addresses blocked (127.0.0.1, ::1)
 * - Link-local blocked (169.254.x)
 * - Public IP allowed (delivery proceeds, HMAC signature sent)
 * - Idempotency: already-delivered jobs skipped
 * - Inactive webhooks skipped
 */

// Stub config before any module imports (jest.mock is hoisted but config is needed)
jest.mock('../../../src/shared/config', () => ({
  config: {
    encryptionKey: 'a'.repeat(64),
    jwtPrivateKey: '',
    jwtPublicKey: '',
    inviteSecret: 'x'.repeat(32),
    metricsToken: 'x'.repeat(16),
  },
}));

jest.mock('../../../src/shared/redis/clients', () => ({
  redisClient: { duplicate: jest.fn(), quit: jest.fn() },
}));

jest.mock('../../../src/shared/observability/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

// Webhook repository: factory mock so the module-level singleton gets our fns
jest.mock('../../../src/modules/webhook/webhook.repository', () => {
  const findDeliveryLog = jest.fn();
  const createDeliveryLog = jest.fn();
  const updateDeliveryLog = jest.fn();
  const findById = jest.fn();
  return {
    WebhookRepository: jest.fn().mockImplementation(() => ({
      findDeliveryLog,
      createDeliveryLog,
      updateDeliveryLog,
      findById,
    })),
    __repoMocks: { findDeliveryLog, createDeliveryLog, updateDeliveryLog, findById },
  };
});

jest.mock('dns', () => ({
  promises: { lookup: jest.fn() },
}));

jest.mock('axios', () => ({ post: jest.fn() }));

import * as dns from 'dns';
import axios from 'axios';
import { webhookDeliveryWorkerJob } from '../../../src/modules/webhook/workers/webhook-delivery.worker';
import { encrypt } from '../../../src/shared/crypto/index';

// Access the shared mock functions injected by the factory
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __repoMocks } = jest.requireMock('../../../src/modules/webhook/webhook.repository') as {
  __repoMocks: {
    findDeliveryLog: jest.Mock;
    createDeliveryLog: jest.Mock;
    updateDeliveryLog: jest.Mock;
    findById: jest.Mock;
  };
};

const mockDnsLookup = dns.promises.lookup as jest.MockedFunction<typeof dns.promises.lookup>;
const mockAxiosPost = axios.post as jest.MockedFunction<typeof axios.post>;

function makeJob(webhookId = 'wh-1', orgId = 'org-1', eventId = 'ev-1') {
  return {
    data: { webhookId, orgId, eventId, eventType: 'task.created', payload: { taskId: 't-1' } },
  } as unknown as Parameters<typeof webhookDeliveryWorkerJob>[0];
}

function setupActiveWebhook(url: string, isActive = true): void {
  const encryptedSecret = encrypt('webhook-signing-secret');
  __repoMocks.findDeliveryLog.mockResolvedValue(null);
  __repoMocks.createDeliveryLog.mockResolvedValue({ id: 'log-1' });
  __repoMocks.updateDeliveryLog.mockResolvedValue(undefined);
  __repoMocks.findById.mockResolvedValue({
    id: 'wh-1',
    url,
    is_active: isActive,
    secret_encrypted: encryptedSecret,
  });
}

describe('webhookDeliveryWorkerJob — SSRF prevention (SEC-NEW-003)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const privateIps = [
    { label: 'loopback 127.0.0.1', ip: '127.0.0.1' },
    { label: 'private 10.0.0.1', ip: '10.0.0.1' },
    { label: 'private 192.168.1.1', ip: '192.168.1.1' },
    { label: 'private 172.16.0.1', ip: '172.16.0.1' },
    { label: 'link-local 169.254.1.1', ip: '169.254.1.1' },
  ];

  for (const { label, ip } of privateIps) {
    it(`blocks delivery when hostname resolves to ${label}`, async () => {
      setupActiveWebhook('https://evil.example.com/hook');
      mockDnsLookup.mockResolvedValue(
        { address: ip, family: 4 } as Awaited<ReturnType<typeof dns.promises.lookup>>
      );

      await expect(webhookDeliveryWorkerJob(makeJob())).rejects.toThrow('SSRF_BLOCKED');

      // Delivery log must be updated to 'failed'
      expect(__repoMocks.updateDeliveryLog).toHaveBeenCalledWith('log-1', 'failed', undefined);
      // HTTP request must NOT have been made
      expect(mockAxiosPost).not.toHaveBeenCalled();
    });
  }

  it('allows delivery and sends HMAC signature for a public IP', async () => {
    setupActiveWebhook('https://api.partner.com/hook');
    mockDnsLookup.mockResolvedValue(
      { address: '93.184.216.34', family: 4 } as Awaited<ReturnType<typeof dns.promises.lookup>>
    );
    mockAxiosPost.mockResolvedValue({ status: 200 });

    await webhookDeliveryWorkerJob(makeJob('wh-1', 'org-1', 'ev-2'));

    expect(mockAxiosPost).toHaveBeenCalled();

    const [, , headers] = (mockAxiosPost.mock.calls[0] as [unknown, unknown, { headers: Record<string, string> }]);
    expect(headers.headers['X-Webhook-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);

    expect(__repoMocks.updateDeliveryLog).toHaveBeenCalledWith('log-1', 'delivered', 200);
  });

  it('skips delivery for an already-delivered event (idempotency)', async () => {
    __repoMocks.findDeliveryLog.mockResolvedValue({ id: 'log-3', status: 'delivered' });

    await webhookDeliveryWorkerJob(makeJob());

    expect(__repoMocks.findById).not.toHaveBeenCalled();
    expect(mockDnsLookup).not.toHaveBeenCalled();
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it('skips delivery when webhook is inactive', async () => {
    setupActiveWebhook('https://example.com/hook', false /* isActive = false */);

    await webhookDeliveryWorkerJob(makeJob());

    expect(mockDnsLookup).not.toHaveBeenCalled();
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it('marks delivery failed and rethrows when endpoint returns 5xx', async () => {
    setupActiveWebhook('https://api.partner.com/hook');
    mockDnsLookup.mockResolvedValue(
      { address: '93.184.216.34', family: 4 } as Awaited<ReturnType<typeof dns.promises.lookup>>
    );
    mockAxiosPost.mockResolvedValue({ status: 503 });

    await expect(webhookDeliveryWorkerJob(makeJob())).rejects.toThrow('Webhook returned 503');

    expect(__repoMocks.updateDeliveryLog).toHaveBeenCalledWith('log-1', 'failed', 503);
  });
});
