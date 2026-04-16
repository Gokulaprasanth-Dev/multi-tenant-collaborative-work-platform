// NOTE: Do NOT call setupZoneTestEnv() here.
// @angular-builders/jest injects jest-preset-angular/setup-jest automatically
// via its internal setup.js, which already calls initTestEnvironment once.
// Calling it again from this file causes "Cannot set base providers because
// it has already been called".

// Polyfill crypto.randomUUID — jsdom does not implement it,
// but Node's built-in crypto module does (Node 14.17+).
import { randomUUID } from 'crypto';
if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID },
    writable: true,
  });
} else if (typeof globalThis.crypto.randomUUID === 'undefined') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: randomUUID,
    writable: true,
  });
}
