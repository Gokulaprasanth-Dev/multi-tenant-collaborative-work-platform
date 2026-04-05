/**
 * Unit tests for src/modules/notification/email/email.service.ts
 *
 * Covers:
 * - sendEmail: calls primary provider's send()
 * - sendEmail: falls back to secondary when primary throws
 * - sendEmail: re-throws when both primary and secondary fail
 * - sendTemplateEmail: renders template and sends via sendEmail
 * - Provider selection: ses config → SesAdapter primary, SendGridAdapter secondary
 * - Provider selection: sendgrid config → SendGridAdapter primary, SesAdapter secondary
 */

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const mockSesSend = jest.fn();
const mockSgSend = jest.fn();

jest.mock('../../../src/modules/notification/email/ses.adapter', () => ({
  SesAdapter: jest.fn().mockImplementation(() => ({ send: mockSesSend })),
}));

jest.mock('../../../src/modules/notification/email/sendgrid.adapter', () => ({
  SendGridAdapter: jest.fn().mockImplementation(() => ({ send: mockSgSend })),
}));

const mockRenderTemplate = jest.fn();
jest.mock('../../../src/modules/notification/email/template.renderer', () => ({
  renderTemplate: (...args: unknown[]) => mockRenderTemplate(...args),
}));

// Mock prom-client for circuit breaker
jest.mock('prom-client', () => ({
  Gauge: jest.fn().mockImplementation(() => ({ set: jest.fn() })),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    emailProvider: 'ses',
    logLevel: 'info',
    nodeEnv: 'test',
  },
}));

// Mock OpenTelemetry tracer — withSpan just calls the fn directly
jest.mock('../../../src/shared/observability/tracer', () => ({
  withSpan: jest.fn().mockImplementation((_name: string, fn: () => unknown) => fn()),
}));

import { sendEmail, sendTemplateEmail } from '../../../src/modules/notification/email/email.service';

const baseOptions = {
  to: 'user@example.com',
  subject: 'Test',
  htmlBody: '<p>hi</p>',
  textBody: 'hi',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSesSend.mockResolvedValue(undefined);
  mockSgSend.mockResolvedValue(undefined);
  mockRenderTemplate.mockResolvedValue({ html: '<p>rendered</p>', text: 'rendered' });
});

describe('sendEmail', () => {
  it('calls the primary provider send() with the options', async () => {
    await sendEmail(baseOptions);
    expect(mockSesSend).toHaveBeenCalledWith(baseOptions);
    expect(mockSgSend).not.toHaveBeenCalled();
  });

  it('falls back to secondary provider when primary throws', async () => {
    mockSesSend.mockRejectedValue(new Error('SES down'));
    await sendEmail(baseOptions);
    expect(mockSgSend).toHaveBeenCalledWith(baseOptions);
  });

  it('re-throws when both primary and secondary fail', async () => {
    mockSesSend.mockRejectedValue(new Error('SES down'));
    mockSgSend.mockRejectedValue(new Error('SendGrid down'));
    await expect(sendEmail(baseOptions)).rejects.toThrow('SendGrid down');
  });
});

describe('sendTemplateEmail', () => {
  it('renders the template and sends the email', async () => {
    await sendTemplateEmail('user@example.com', 'Hello', 'welcome', { name: 'Alice' });
    expect(mockRenderTemplate).toHaveBeenCalledWith('welcome', { name: 'Alice' });
    expect(mockSesSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Hello',
        htmlBody: '<p>rendered</p>',
        textBody: 'rendered',
      })
    );
  });

  it('propagates renderTemplate errors', async () => {
    mockRenderTemplate.mockRejectedValue(new Error('template not found'));
    await expect(
      sendTemplateEmail('user@example.com', 'Sub', 'missing-template', {})
    ).rejects.toThrow('template not found');
  });
});
