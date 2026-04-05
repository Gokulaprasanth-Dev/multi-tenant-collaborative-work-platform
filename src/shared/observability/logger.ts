import pino from 'pino';
import { config } from '../config';
import { sanitiseReq } from './log-sanitiser';

export const logger = pino({
  level: config.logLevel,
  transport: config.nodeEnv === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  formatters: { level: (label) => ({ level: label }) },
  base: { service: process.env.SERVICE_NAME || 'app' },
  serializers: {
    req: (req: Record<string, unknown>) => sanitiseReq(req),
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'body.password', 'body.password_hash',
      'body.token', 'body.access_token', 'body.refresh_token',
      'body.secret', 'body.totp_secret', 'body.totp_secret_encrypted',
      'body.api_key', 'body.webhook_secret', 'body.encryption_key',
      'body.backup_codes', 'body.mfa_backup_codes',
      '*.password_hash', '*.totp_secret', '*.mfa_backup_codes',
      '*.secret', '*.api_key', '*.webhook_secret', '*.encryption_key',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
