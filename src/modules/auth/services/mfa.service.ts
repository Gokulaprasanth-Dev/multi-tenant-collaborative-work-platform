import * as crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { AuthRepository } from '../repositories/auth.repository';
import { persistAuditLog } from '../../audit/workers/audit.worker';
import { encrypt, decrypt } from '../../../shared/crypto';

const repo = new AuthRepository();

const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_LENGTH = 10;
const BACKUP_CODE_BCRYPT_COST = 10;
const BACKUP_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateAlphanumericCode(length: number): string {
  const bytes = crypto.randomBytes(length * 2);
  let result = '';
  for (let i = 0; i < bytes.length && result.length < length; i++) {
    const idx = bytes[i] % BACKUP_CODE_CHARS.length;
    result += BACKUP_CODE_CHARS[idx];
  }
  return result;
}

// ─── TOTP ──────────────────────────────────────────────────────────────────

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/** Returns the TOTP URI for QR code generation. */
export function getTotpUri(secret: string, email: string, issuer: string): string {
  return authenticator.keyuri(email, issuer, secret);
}

/** Verifies a TOTP code against a (plaintext) secret. */
export function verifyTotp(token: string, secret: string): boolean {
  return authenticator.verify({ token, secret });
}

/**
 * Enables TOTP for a user: encrypts the secret before storing.
 * Acceptance criteria: TOTP secret stored encrypted (not plaintext) in DB.
 */
export async function enableTotp(userId: string, plaintextSecret: string): Promise<void> {
  const encryptedSecret = encrypt(plaintextSecret);
  await repo.updateUser(userId, { totp_secret: encryptedSecret, totp_enabled: true });
}

/** Verifies a TOTP code for a user (decrypts stored secret). */
export async function verifyUserTotp(userId: string, token: string): Promise<boolean> {
  const user = await repo.findUserById(userId);
  if (!user || !user.totp_enabled || !user.totp_secret) return false;
  const plaintextSecret = decrypt(user.totp_secret);
  return verifyTotp(token, plaintextSecret);
}

// ─── Backup codes ─────────────────────────────────────────────────────────

export async function generateBackupCodes(userId: string): Promise<string[]> {
  const plainCodes: string[] = [];
  const hashes: string[] = [];

  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = generateAlphanumericCode(BACKUP_CODE_LENGTH);
    plainCodes.push(code);
    hashes.push(await bcrypt.hash(code, BACKUP_CODE_BCRYPT_COST));
  }

  await repo.updateUser(userId, {
    mfa_backup_codes: hashes,
    mfa_backup_codes_generated_at: new Date(),
  });

  return plainCodes; // Return plain codes ONCE — never stored
}

export async function verifyBackupCode(userId: string, code: string): Promise<boolean> {
  const user = await repo.findUserById(userId);
  if (!user || !user.mfa_backup_codes || user.mfa_backup_codes.length === 0) return false;

  for (let i = 0; i < user.mfa_backup_codes.length; i++) {
    const match = await bcrypt.compare(code, user.mfa_backup_codes[i]);
    if (match) {
      // Single-use: remove the matched hash from the array
      const updatedCodes = [...user.mfa_backup_codes];
      updatedCodes.splice(i, 1);
      await repo.updateUser(userId, { mfa_backup_codes: updatedCodes });

      await persistAuditLog({
        actorId: userId,
        actorType: 'user',
        eventType: 'user.backup_code_used',
        entityType: 'user',
        entityId: userId,
      });

      return true;
    }
  }

  return false;
}
