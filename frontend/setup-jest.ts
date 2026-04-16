// Initialize Angular test environment (TestBed.initTestEnvironment)
import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';
setupZoneTestEnv();

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
