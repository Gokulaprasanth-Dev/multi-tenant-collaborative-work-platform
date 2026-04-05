// Unit tests — no DB or Redis required

// Stub Redis before importing token module
jest.mock('../../../src/shared/redis/clients', () => ({
  redisClient: { set: jest.fn().mockResolvedValue('OK') },
}));

// Stub config
jest.mock('../../../src/shared/config', () => ({
  config: {
    jwtPrivateKey: require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
      .export({ type: 'pkcs1', format: 'pem' }),
    jwtPublicKey: (() => {
      const { publicKey } = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 });
      return publicKey.export({ type: 'pkcs1', format: 'pem' });
    })(),
    jwtAccessTokenTtl: 900,
    encryptionKey: 'a'.repeat(64),
    inviteSecret: 'x'.repeat(32),
    metricsToken: 'x'.repeat(16),
  },
}));

import jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import {
  generateAccessToken,
  generateRefreshToken,
  blacklistToken,
  generateEmailVerificationToken,
  generatePasswordResetToken,
  generateMagicLinkToken,
  verifyTokenHash,
  hashToken,
} from '../../../src/modules/auth/utils/token';
import { redisClient } from '../../../src/shared/redis/clients';

// Generate a real RSA key pair for tests
let privateKey: string;
let publicKey: string;

beforeAll(() => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
  publicKey = pair.publicKey.export({ type: 'pkcs1', format: 'pem' }) as string;

  // Override config with real keys
  const configModule = require('../../../src/shared/config');
  configModule.config.jwtPrivateKey = privateKey;
  configModule.config.jwtPublicKey = publicKey;
});

describe('generateAccessToken', () => {
  it('produces a valid RS256 JWT', () => {
    const token = generateAccessToken({ sub: 'user-1', orgId: 'org-1', role: 'member' });
    const decoded = jwt.decode(token, { complete: true }) as unknown as { header: Record<string, unknown>; payload: Record<string, unknown> };
    expect(decoded.header['alg']).toBe('RS256');
    expect(decoded.header['kid']).toBe('default');
  });

  it('includes auth_time claim', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = generateAccessToken({ sub: 'user-1', orgId: 'org-1', role: 'member' });
    const payload = jwt.decode(token) as Record<string, unknown>;
    expect(typeof payload['auth_time']).toBe('number');
    expect(payload['auth_time'] as number).toBeGreaterThanOrEqual(before);
  });

  it('exp is ~900s from now', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = generateAccessToken({ sub: 'user-1', orgId: 'org-1', role: 'member' });
    const payload = jwt.decode(token) as Record<string, unknown>;
    const exp = payload['exp'] as number;
    expect(exp - before).toBeGreaterThanOrEqual(898);
    expect(exp - before).toBeLessThanOrEqual(902);
  });

  it('includes a unique jti', () => {
    const t1 = generateAccessToken({ sub: 'u', orgId: 'o', role: 'member' });
    const t2 = generateAccessToken({ sub: 'u', orgId: 'o', role: 'member' });
    const p1 = jwt.decode(t1) as Record<string, unknown>;
    const p2 = jwt.decode(t2) as Record<string, unknown>;
    expect(p1['jti']).not.toBe(p2['jti']);
  });
});

describe('generateRefreshToken', () => {
  it('returns a 64-char hex string', () => {
    const token = generateRefreshToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique tokens', () => {
    expect(generateRefreshToken()).not.toBe(generateRefreshToken());
  });
});

describe('blacklistToken', () => {
  it('calls redisClient.set with correct key and TTL', async () => {
    await blacklistToken('test-jti-123', 900);
    expect(redisClient.set).toHaveBeenCalledWith('blacklist:token:test-jti-123', '1', 'EX', 900);
  });
});

describe('token generation helpers', () => {
  it('generateEmailVerificationToken has 24h TTL', () => {
    const { expiresAt } = generateEmailVerificationToken();
    const diffMs = expiresAt.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(diffMs).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it('generatePasswordResetToken has 1h TTL', () => {
    const { expiresAt } = generatePasswordResetToken();
    const diffMs = expiresAt.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(59 * 60 * 1000);
    expect(diffMs).toBeLessThan(61 * 60 * 1000);
  });

  it('generateMagicLinkToken has 15min TTL', () => {
    const { expiresAt } = generateMagicLinkToken();
    const diffMs = expiresAt.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(14 * 60 * 1000);
    expect(diffMs).toBeLessThan(16 * 60 * 1000);
  });
});

describe('verifyTokenHash', () => {
  it('returns true when hash matches', () => {
    const token = 'abc123';
    const hash = hashToken(token);
    expect(verifyTokenHash(token, hash)).toBe(true);
  });

  it('returns false when hash does not match', () => {
    expect(verifyTokenHash('abc123', hashToken('different'))).toBe(false);
  });
});
