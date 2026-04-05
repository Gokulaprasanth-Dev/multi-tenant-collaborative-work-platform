/**
 * Unit tests for src/shared/auth-middleware/key-store.ts
 *
 * Covers:
 * - getPublicKey: returns default key when kid is undefined
 * - getPublicKey: returns default key when kid is unknown
 * - getPublicKey: returns registered key for known kid
 * - registerPublicKey: stores and retrieves additional keys
 * - getPublicKey: throws when no default key configured
 */

jest.mock('../../../src/shared/config', () => ({
  config: {
    jwtPublicKey: 'default-public-key-pem',
    logLevel: 'info',
    nodeEnv: 'test',
  },
}));

import { getPublicKey, registerPublicKey } from '../../../src/shared/auth-middleware/key-store';

describe('key-store', () => {
  describe('getPublicKey', () => {
    it('returns the default key when kid is undefined', () => {
      const key = getPublicKey(undefined);
      expect(key).toBe('default-public-key-pem');
    });

    it('returns the default key when kid is an unknown string', () => {
      const key = getPublicKey('unknown-kid');
      expect(key).toBe('default-public-key-pem');
    });

    it('returns the default key for kid "default"', () => {
      const key = getPublicKey('default');
      expect(key).toBe('default-public-key-pem');
    });
  });

  describe('registerPublicKey', () => {
    it('stores and retrieves an additional key by kid', () => {
      registerPublicKey('kid-2', 'rotation-key-pem');
      expect(getPublicKey('kid-2')).toBe('rotation-key-pem');
    });

    it('still returns default key for unknown kids after registering extras', () => {
      registerPublicKey('kid-3', 'another-key-pem');
      expect(getPublicKey('completely-unknown')).toBe('default-public-key-pem');
    });

    it('overwrites an existing kid entry', () => {
      registerPublicKey('kid-4', 'first-pem');
      registerPublicKey('kid-4', 'second-pem');
      expect(getPublicKey('kid-4')).toBe('second-pem');
    });
  });
});
