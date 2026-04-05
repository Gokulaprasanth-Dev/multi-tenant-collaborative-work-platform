/**
 * Unit tests for shared crypto utilities
 *
 * Covers:
 * - encrypt/decrypt round-trip
 * - Different plaintexts produce different ciphertexts
 * - hmac is deterministic and secret-dependent
 * - timingSafeEqual handles equal/unequal/different-length inputs
 * - generateSecureToken produces correct length hex strings
 * - hashToken is deterministic sha256 hex
 */

import { encrypt, decrypt, hmac, timingSafeEqual, generateSecureToken, hashToken } from '../../../src/shared/crypto';

describe('Crypto utilities', () => {
  describe('encrypt / decrypt', () => {
    it('round-trips correctly', () => {
      const plaintext = 'hello world secret';
      const ciphertext = encrypt(plaintext);
      expect(decrypt(ciphertext)).toBe(plaintext);
    });

    it('produces different ciphertext each call (random IV)', () => {
      const plaintext = 'same input';
      const c1 = encrypt(plaintext);
      const c2 = encrypt(plaintext);
      expect(c1).not.toBe(c2);
    });

    it('ciphertext format is v{N}:iv:enc:tag', () => {
      const ciphertext = encrypt('test');
      const parts = ciphertext.split(':');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('v1');
    });

    it('throws on tampered ciphertext', () => {
      const ciphertext = encrypt('data');
      const parts = ciphertext.split(':');
      // Corrupt the auth tag
      parts[3] = Buffer.from('tampered').toString('base64');
      expect(() => decrypt(parts.join(':'))).toThrow();
    });

    it('throws on wrong format', () => {
      expect(() => decrypt('not:valid')).toThrow('Invalid ciphertext format');
    });

    it('handles empty string', () => {
      const c = encrypt('');
      expect(decrypt(c)).toBe('');
    });

    it('handles unicode', () => {
      const plaintext = '日本語テスト 🔐';
      expect(decrypt(encrypt(plaintext))).toBe(plaintext);
    });
  });

  describe('hmac', () => {
    it('is deterministic with the same key and data', () => {
      const h1 = hmac('data', 'secret');
      const h2 = hmac('data', 'secret');
      expect(h1).toBe(h2);
    });

    it('produces different results for different data', () => {
      expect(hmac('data1', 'secret')).not.toBe(hmac('data2', 'secret'));
    });

    it('produces different results for different secrets', () => {
      expect(hmac('data', 'secret1')).not.toBe(hmac('data', 'secret2'));
    });

    it('returns a 64-char hex string (SHA-256)', () => {
      const result = hmac('any data', 'any secret');
      expect(result).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(result)).toBe(true);
    });
  });

  describe('timingSafeEqual', () => {
    it('returns true for equal strings', () => {
      expect(timingSafeEqual('abc', 'abc')).toBe(true);
    });

    it('returns false for different strings of same length', () => {
      expect(timingSafeEqual('abc', 'xyz')).toBe(false);
    });

    it('returns false for different-length strings', () => {
      expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    });

    it('returns true for empty strings', () => {
      expect(timingSafeEqual('', '')).toBe(true);
    });
  });

  describe('generateSecureToken', () => {
    it('returns a hex string of 2*bytes length', () => {
      const token = generateSecureToken(32);
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    });

    it('default is 32 bytes (64 hex chars)', () => {
      expect(generateSecureToken()).toHaveLength(64);
    });

    it('produces unique tokens each call', () => {
      const t1 = generateSecureToken();
      const t2 = generateSecureToken();
      expect(t1).not.toBe(t2);
    });

    it('respects custom byte length', () => {
      expect(generateSecureToken(16)).toHaveLength(32);
      expect(generateSecureToken(8)).toHaveLength(16);
    });
  });

  describe('hashToken', () => {
    it('is deterministic', () => {
      expect(hashToken('token')).toBe(hashToken('token'));
    });

    it('returns 64-char sha256 hex', () => {
      const h = hashToken('any token');
      expect(h).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);
    });

    it('different inputs produce different hashes', () => {
      expect(hashToken('token1')).not.toBe(hashToken('token2'));
    });
  });
});
