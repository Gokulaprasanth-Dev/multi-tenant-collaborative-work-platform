/**
 * Unit tests for src/modules/notification/email/smtp.adapter.ts
 *
 * Covers:
 * - send: calls transporter.sendMail with correct from/to/subject/html/text
 * - send: passes optional headers through to sendMail
 * - send: creates transport without auth when smtpUser is not set
 * - send: creates transport with auth when smtpUser is set
 * - send: propagates errors from sendMail (circuit breaker fires through)
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn();

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: (...args: unknown[]) => mockCreateTransport(...args),
  },
}));

// Mock prom-client Gauge used by circuit-breaker
jest.mock('prom-client', () => ({
  Gauge: jest.fn().mockImplementation(() => ({ set: jest.fn() })),
}));

const mockConfig = {
  smtpHost: 'localhost',
  smtpPort: 1025,
  smtpSecure: false,
  smtpUser: undefined as string | undefined,
  smtpPass: undefined as string | undefined,
  smtpFromEmail: 'dev@localhost',
  encryptionKey: 'a'.repeat(64),
  jwtPrivateKey: '',
  jwtPublicKey: '',
  jwtAccessTokenTtl: 900,
  inviteSecret: 'x'.repeat(32),
  metricsToken: 'x'.repeat(16),
  logLevel: 'silent',
  nodeEnv: 'test',
};

jest.mock('../../../src/shared/config', () => ({ config: mockConfig }));

import { SmtpAdapter } from '../../../src/modules/notification/email/smtp.adapter';

describe('SmtpAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });
    mockConfig.smtpUser = undefined;
    mockConfig.smtpPass = undefined;
  });

  it('calls sendMail with correct from/to/subject/html/text', async () => {
    const adapter = new SmtpAdapter();
    await adapter.send({
      to: 'user@example.com',
      subject: 'Hello',
      htmlBody: '<p>Hi</p>',
      textBody: 'Hi',
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'dev@localhost',
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      })
    );
  });

  it('passes optional headers through to sendMail', async () => {
    const adapter = new SmtpAdapter();
    await adapter.send({
      to: 'user@example.com',
      subject: 'With headers',
      htmlBody: '<p>x</p>',
      textBody: 'x',
      headers: { 'X-Custom': 'value' },
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'X-Custom': 'value' } })
    );
  });

  it('creates transport without auth when smtpUser is not set', () => {
    new SmtpAdapter();
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'localhost',
        port: 1025,
        secure: false,
        auth: undefined,
      })
    );
  });

  it('creates transport with auth when smtpUser is set', () => {
    mockConfig.smtpUser = 'user@smtp.example.com';
    mockConfig.smtpPass = 'secret';
    new SmtpAdapter();
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: 'user@smtp.example.com', pass: 'secret' },
      })
    );
  });

  it('uses empty string for pass when smtpUser set but smtpPass undefined', () => {
    mockConfig.smtpUser = 'user@smtp.example.com';
    mockConfig.smtpPass = undefined;
    new SmtpAdapter();
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: 'user@smtp.example.com', pass: '' },
      })
    );
  });

  it('propagates errors thrown by sendMail', async () => {
    const adapter = new SmtpAdapter();
    mockSendMail.mockRejectedValue(new Error('SMTP connection refused'));
    await expect(
      adapter.send({ to: 'user@example.com', subject: 'Fail', htmlBody: '<p/>', textBody: '' })
    ).rejects.toThrow('SMTP connection refused');
  });
});
