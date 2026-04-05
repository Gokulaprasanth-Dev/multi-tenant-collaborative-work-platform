import * as crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 1;

/** Encrypts with AES-256-GCM. Returns v{N}:{b64_iv}:{b64_ciphertext}:{b64_authTag} */
export function encrypt(plaintext: string): string {
  const key = Buffer.from(config.encryptionKey, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let enc = cipher.update(plaintext, 'utf8', 'base64');
  enc += cipher.final('base64');
  return `v${KEY_VERSION}:${iv.toString('base64')}:${enc}:${cipher.getAuthTag().toString('base64')}`;
}

/** Decrypts ciphertext from encrypt(). */
export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4) throw new Error('Invalid ciphertext format');
  const [, ivB64, encB64, tagB64] = parts;
  const key = Buffer.from(config.encryptionKey, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  let dec = decipher.update(encB64, 'base64', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function hmac(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/** Constant-time comparison. Returns false if lengths differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Encrypts a webhook secret — alias for encrypt() */
export const encryptSecret = encrypt;

/** Decrypts a webhook secret — alias for decrypt() */
export const decryptSecret = decrypt;
