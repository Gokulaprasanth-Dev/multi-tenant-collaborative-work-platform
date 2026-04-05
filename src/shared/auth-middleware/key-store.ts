import { config } from '../config';

const DEFAULT_KID = 'default';

// Map of kid → PEM public key — supports multiple keys for rotation overlap
const keyStore = new Map<string, string>();
keyStore.set(DEFAULT_KID, config.jwtPublicKey);

/**
 * Returns the RSA public key for the given kid.
 * Falls back to the default key if kid is undefined or not found (rotation grace period).
 */
export function getPublicKey(kid?: string): string {
  if (kid && keyStore.has(kid)) {
    return keyStore.get(kid)!;
  }
  const defaultKey = keyStore.get(DEFAULT_KID);
  if (!defaultKey) throw new Error('No JWT public key configured');
  return defaultKey;
}

/** Registers an additional public key for key rotation overlap. */
export function registerPublicKey(kid: string, pem: string): void {
  keyStore.set(kid, pem);
}
