/**
 * TASK-096 — Log sanitisation.
 * Recursively redacts sensitive keys and JWT-shaped string values.
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'totp_secret',
  'totp_secret_encrypted',
  'backup_codes',
  'mfa_backup_codes',
  'api_key',
  'webhook_secret',
  'encryption_key',
]);

// Matches a JWT: three base64url segments separated by dots
const JWT_PATTERN = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function sanitiseLogData(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return JWT_PATTERN.test(obj) ? '[REDACTED_JWT]' : obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitiseLogData);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitiseLogData(value);
      }
    }
    return result;
  }
  return obj;
}

/**
 * Pino serializer for request objects — redacts Authorization header.
 */
export function sanitiseReq(req: Record<string, unknown>): Record<string, unknown> {
  const headers = { ...(req.headers as Record<string, unknown>) };
  if (headers.authorization) {
    headers.authorization = '[REDACTED]';
  }
  return { ...req, headers };
}
