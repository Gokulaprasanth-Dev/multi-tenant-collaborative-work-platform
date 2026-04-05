/**
 * Unit tests for log-sanitiser.ts (TASK-096)
 *
 * Covers:
 * - sanitiseLogData: redacts sensitive keys (case-insensitive)
 * - sanitiseLogData: redacts JWT-shaped strings inline
 * - sanitiseLogData: recursively sanitises nested objects
 * - sanitiseLogData: sanitises arrays
 * - sanitiseLogData: leaves non-sensitive data untouched
 * - sanitiseLogData: handles null, numbers, booleans
 * - sanitiseReq: redacts Authorization header
 * - sanitiseReq: leaves other request fields intact
 */

import { sanitiseLogData, sanitiseReq } from '../../../src/shared/observability/log-sanitiser';

// A valid-looking JWT (three base64url segments)
const FAKE_JWT =
  'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('sanitiseLogData', () => {
  // ── Sensitive key redaction ─────────────────────────────────────────────────

  it('redacts the "password" key', () => {
    const result = sanitiseLogData({ password: 'hunter2' }) as Record<string, unknown>;
    expect(result.password).toBe('[REDACTED]');
  });

  it('redacts "password_hash"', () => {
    const result = sanitiseLogData({ password_hash: '$2b$10$hash' }) as Record<string, unknown>;
    expect(result.password_hash).toBe('[REDACTED]');
  });

  it('redacts "token"', () => {
    const result = sanitiseLogData({ token: 'some-token' }) as Record<string, unknown>;
    expect(result.token).toBe('[REDACTED]');
  });

  it('redacts "access_token"', () => {
    const result = sanitiseLogData({ access_token: FAKE_JWT }) as Record<string, unknown>;
    expect(result.access_token).toBe('[REDACTED]');
  });

  it('redacts "refresh_token"', () => {
    const result = sanitiseLogData({ refresh_token: 'rt-value' }) as Record<string, unknown>;
    expect(result.refresh_token).toBe('[REDACTED]');
  });

  it('redacts "secret"', () => {
    const result = sanitiseLogData({ secret: 'my-secret' }) as Record<string, unknown>;
    expect(result.secret).toBe('[REDACTED]');
  });

  it('redacts "totp_secret"', () => {
    const result = sanitiseLogData({ totp_secret: 'BASE32SECRET' }) as Record<string, unknown>;
    expect(result.totp_secret).toBe('[REDACTED]');
  });

  it('redacts "mfa_backup_codes"', () => {
    const result = sanitiseLogData({ mfa_backup_codes: ['code1', 'code2'] }) as Record<string, unknown>;
    expect(result.mfa_backup_codes).toBe('[REDACTED]');
  });

  it('redacts "api_key"', () => {
    const result = sanitiseLogData({ api_key: 'sk-prod-xxx' }) as Record<string, unknown>;
    expect(result.api_key).toBe('[REDACTED]');
  });

  it('redacts "encryption_key"', () => {
    const result = sanitiseLogData({ encryption_key: 'a'.repeat(64) }) as Record<string, unknown>;
    expect(result.encryption_key).toBe('[REDACTED]');
  });

  // ── JWT inline redaction ────────────────────────────────────────────────────

  it('redacts a JWT string at the top level', () => {
    const result = sanitiseLogData(FAKE_JWT);
    expect(result).toBe('[REDACTED_JWT]');
  });

  it('redacts JWT strings inside non-sensitive keys', () => {
    const result = sanitiseLogData({ authorization: FAKE_JWT }) as Record<string, unknown>;
    expect(result.authorization).toBe('[REDACTED_JWT]');
  });

  it('does not redact a non-JWT string', () => {
    const result = sanitiseLogData({ message: 'hello world' }) as Record<string, unknown>;
    expect(result.message).toBe('hello world');
  });

  // ── Recursive sanitisation ──────────────────────────────────────────────────

  it('recursively sanitises nested objects', () => {
    const result = sanitiseLogData({
      user: { id: 'u-1', password: 'secret' },
    }) as { user: Record<string, unknown> };
    expect(result.user.id).toBe('u-1');
    expect(result.user.password).toBe('[REDACTED]');
  });

  it('recursively sanitises arrays', () => {
    const result = sanitiseLogData([
      { token: 'abc' },
      { message: 'ok' },
    ]) as Array<Record<string, unknown>>;
    expect(result[0]!.token).toBe('[REDACTED]');
    expect(result[1]!.message).toBe('ok');
  });

  it('sanitises JWT strings inside an array', () => {
    const result = sanitiseLogData(['safe', FAKE_JWT]) as string[];
    expect(result[0]).toBe('safe');
    expect(result[1]).toBe('[REDACTED_JWT]');
  });

  // ── Non-sensitive data ──────────────────────────────────────────────────────

  it('leaves non-sensitive string fields untouched', () => {
    const result = sanitiseLogData({ userId: 'u-1', orgId: 'o-1' }) as Record<string, unknown>;
    expect(result.userId).toBe('u-1');
    expect(result.orgId).toBe('o-1');
  });

  it('passes through null', () => {
    expect(sanitiseLogData(null)).toBeNull();
  });

  it('passes through numbers', () => {
    expect(sanitiseLogData(42)).toBe(42);
  });

  it('passes through booleans', () => {
    expect(sanitiseLogData(true)).toBe(true);
  });
});

describe('sanitiseReq', () => {
  it('redacts Authorization header', () => {
    const req = {
      method: 'GET',
      url: '/api/v1/tasks',
      headers: {
        authorization: `Bearer ${FAKE_JWT}`,
        'content-type': 'application/json',
      },
    };

    const result = sanitiseReq(req as Record<string, unknown>) as {
      headers: Record<string, unknown>;
      method: string;
    };
    expect(result.headers.authorization).toBe('[REDACTED]');
    expect(result.headers['content-type']).toBe('application/json');
  });

  it('leaves non-Authorization headers untouched', () => {
    const req = {
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { 'x-request-id': 'req-123' },
    };

    const result = sanitiseReq(req as Record<string, unknown>) as {
      headers: Record<string, unknown>;
    };
    expect(result.headers['x-request-id']).toBe('req-123');
  });

  it('preserves method and url fields', () => {
    const req = {
      method: 'DELETE',
      url: '/api/v1/tasks/t-1',
      headers: {},
    };

    const result = sanitiseReq(req as Record<string, unknown>);
    expect(result.method).toBe('DELETE');
    expect(result.url).toBe('/api/v1/tasks/t-1');
  });

  it('does not throw when authorization header is absent', () => {
    const req = { method: 'GET', headers: {} };
    expect(() => sanitiseReq(req as Record<string, unknown>)).not.toThrow();
  });
});
