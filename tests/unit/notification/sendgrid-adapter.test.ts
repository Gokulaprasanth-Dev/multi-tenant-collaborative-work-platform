/**
 * Unit tests for src/modules/notification/email/sendgrid.adapter.ts
 *
 * Covers:
 * - send: calls sgMail.send with correct message shape
 * - send: propagates errors from sgMail.send (circuit breaker fires through)
 * - send: uses config.awsSesFromEmail as from address
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const mockSgMailSend = jest.fn();
const mockSgMailSetApiKey = jest.fn();

jest.mock('@sendgrid/mail', () => ({
  __esModule: true,
  default: {
    setApiKey: mockSgMailSetApiKey,
    send: mockSgMailSend,
  },
}));

// Mock prom-client Gauge used by circuit-breaker
jest.mock('prom-client', () => ({
  Gauge: jest.fn().mockImplementation(() => ({ set: jest.fn() })),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    sendgridApiKey: 'SG.test-key',
    awsSesFromEmail: 'noreply@example.com',
    encryptionKey: 'a'.repeat(64),
    jwtPrivateKey: '',
    jwtPublicKey: '',
    jwtAccessTokenTtl: 900,
    inviteSecret: 'x'.repeat(32),
    metricsToken: 'x'.repeat(16),
    logLevel: 'info',
    nodeEnv: 'test',
  },
}));

import { SendGridAdapter } from '../../../src/modules/notification/email/sendgrid.adapter';

describe('SendGridAdapter', () => {
  let adapter: SendGridAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSgMailSend.mockResolvedValue([{ statusCode: 202 }]);
    adapter = new SendGridAdapter();
  });

  it('calls sgMail.send with correct to/from/subject/html/text', async () => {
    await adapter.send({
      to: 'user@example.com',
      subject: 'Hello',
      htmlBody: '<p>Hi</p>',
      textBody: 'Hi',
    });

    expect(mockSgMailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        from: 'noreply@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      })
    );
  });

  it('passes optional headers through to sgMail.send', async () => {
    await adapter.send({
      to: 'user@example.com',
      subject: 'With headers',
      htmlBody: '<p>x</p>',
      textBody: 'x',
      headers: { 'X-Custom': 'value' },
    });

    expect(mockSgMailSend).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'X-Custom': 'value' } })
    );
  });

  it('propagates errors thrown by sgMail.send', async () => {
    mockSgMailSend.mockRejectedValue(new Error('SendGrid error'));
    await expect(
      adapter.send({ to: 'user@example.com', subject: 'Fail', htmlBody: '<p/>', textBody: '' })
    ).rejects.toThrow('SendGrid error');
  });

  it('initialises sgMail with the configured API key', () => {
    expect(mockSgMailSetApiKey).toHaveBeenCalledWith('SG.test-key');
  });
});
