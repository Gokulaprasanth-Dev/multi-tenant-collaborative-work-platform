/**
 * Integration tests for MFA service (mfa.service.ts)
 *
 * Covers:
 * - generateTotpSecret: returns a valid base32 secret
 * - getTotpUri: returns otpauth:// URI with correct fields
 * - verifyTotp: correctly validates TOTP tokens
 * - enableTotp: stores encrypted secret in DB
 * - verifyUserTotp: decrypts stored secret and validates token
 * - generateBackupCodes: stores 8 hashed codes, returns 8 plain codes
 * - verifyBackupCode: accepts valid code (single-use), rejects reuse, rejects wrong code
 */

import { authenticator } from 'otplib';
import { seedUser } from '../../helpers/db';
import { queryPrimary } from '../../../src/shared/database/pool';
import {
  generateTotpSecret,
  getTotpUri,
  verifyTotp,
  enableTotp,
  verifyUserTotp,
  generateBackupCodes,
  verifyBackupCode,
} from '../../../src/modules/auth/services/mfa.service';

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const maybeDescribe = RUN_INTEGRATION ? describe : describe.skip;

maybeDescribe('MFA Service', () => {
  // ── Pure / stateless functions ─────────────────────────────────────────────

  describe('generateTotpSecret', () => {
    it('returns a non-empty base32 string', () => {
      const secret = generateTotpSecret();
      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThan(0);
      // Base32 charset only
      expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    });

    it('returns different secrets on each call', () => {
      const a = generateTotpSecret();
      const b = generateTotpSecret();
      expect(a).not.toBe(b);
    });
  });

  describe('getTotpUri', () => {
    it('returns a valid otpauth:// URI', () => {
      const secret = generateTotpSecret();
      const uri = getTotpUri(secret, 'user@example.com', 'TestApp');
      expect(uri).toMatch(/^otpauth:\/\/totp\//);
      expect(uri).toContain('TestApp');
      expect(uri).toContain(encodeURIComponent('user@example.com'));
      expect(uri).toContain(`secret=${secret}`);
    });
  });

  describe('verifyTotp', () => {
    it('returns true for a valid current token', () => {
      const secret = generateTotpSecret();
      const token = authenticator.generate(secret);
      expect(verifyTotp(token, secret)).toBe(true);
    });

    it('returns false for a wrong token', () => {
      const secret = generateTotpSecret();
      expect(verifyTotp('000000', secret)).toBe(false);
    });

    it('returns false for wrong secret', () => {
      const secret = generateTotpSecret();
      const otherSecret = generateTotpSecret();
      const token = authenticator.generate(secret);
      expect(verifyTotp(token, otherSecret)).toBe(false);
    });
  });

  // ── DB-backed functions ────────────────────────────────────────────────────

  describe('enableTotp + verifyUserTotp', () => {
    it('stores encrypted secret and verifies correctly', async () => {
      const { userId } = await seedUser();
      const secret = generateTotpSecret();

      await enableTotp(userId, secret);

      // Confirm secret is stored encrypted (not plaintext)
      const row = await queryPrimary<{ totp_secret: string; totp_enabled: boolean }>(
        `SELECT totp_secret, totp_enabled FROM users WHERE id = $1`,
        [userId]
      );
      expect(row.rows[0]!.totp_enabled).toBe(true);
      expect(row.rows[0]!.totp_secret).not.toBe(secret); // must be encrypted
      expect(row.rows[0]!.totp_secret).toMatch(/^v\d+:/); // AES-GCM format

      // Verify with a current token
      const token = authenticator.generate(secret);
      const valid = await verifyUserTotp(userId, token);
      expect(valid).toBe(true);
    });

    it('returns false for user without TOTP enabled', async () => {
      const { userId } = await seedUser();
      // totp_enabled defaults to false
      const valid = await verifyUserTotp(userId, '123456');
      expect(valid).toBe(false);
    });

    it('returns false for wrong token', async () => {
      const { userId } = await seedUser();
      const secret = generateTotpSecret();
      await enableTotp(userId, secret);
      const valid = await verifyUserTotp(userId, '000000');
      expect(valid).toBe(false);
    });
  });

  describe('generateBackupCodes + verifyBackupCode', () => {
    it('generates 8 plain codes and stores 8 hashes', async () => {
      const { userId } = await seedUser();
      const codes = await generateBackupCodes(userId);

      expect(codes).toHaveLength(8);
      codes.forEach(code => expect(code.length).toBe(10));

      const row = await queryPrimary<{ mfa_backup_codes: string[] }>(
        `SELECT mfa_backup_codes FROM users WHERE id = $1`,
        [userId]
      );
      expect(row.rows[0]!.mfa_backup_codes).toHaveLength(8);
    });

    it('accepts a valid backup code', async () => {
      const { userId } = await seedUser();
      const codes = await generateBackupCodes(userId);

      const result = await verifyBackupCode(userId, codes[0]!);
      expect(result).toBe(true);
    });

    it('backup code is single-use — rejected on second attempt', async () => {
      const { userId } = await seedUser();
      const codes = await generateBackupCodes(userId);

      await verifyBackupCode(userId, codes[0]!);  // first use — succeeds
      const second = await verifyBackupCode(userId, codes[0]!); // reuse — fails
      expect(second).toBe(false);
    });

    it('removes used code, leaving remaining codes intact', async () => {
      const { userId } = await seedUser();
      const codes = await generateBackupCodes(userId);

      await verifyBackupCode(userId, codes[0]!);

      const row = await queryPrimary<{ mfa_backup_codes: string[] }>(
        `SELECT mfa_backup_codes FROM users WHERE id = $1`,
        [userId]
      );
      // 7 remaining after one used
      expect(row.rows[0]!.mfa_backup_codes).toHaveLength(7);
    });

    it('rejects an incorrect backup code', async () => {
      const { userId } = await seedUser();
      await generateBackupCodes(userId);

      const result = await verifyBackupCode(userId, 'INVALID-CODE');
      expect(result).toBe(false);
    });

    it('returns false for user with no backup codes', async () => {
      const { userId } = await seedUser();
      const result = await verifyBackupCode(userId, 'anycode');
      expect(result).toBe(false);
    });
  });
});
