/**
 * Unit tests for LocalAdapter (shared/storage/local.adapter.ts)
 *
 * Covers:
 * - generateUploadUrl: returns correct URL format with key
 * - generateUploadUrl: expiresAt is in the future
 * - generateDownloadUrl: returns correct URL format with key
 * - delete: silently no-ops for a non-existent file (ENOENT)
 * - delete: removes an existing file
 * - exists: returns false for non-existent file
 * - exists: returns true for an existing file
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocalAdapter } from '../../../src/shared/storage/local.adapter';

// We need to temporarily redirect the upload dir to a temp path to avoid
// polluting the project and allow isolated file operations.
// Since UPLOAD_DIR is private inside local.adapter.ts, we test via the public API only.

describe('LocalAdapter', () => {
  let adapter: LocalAdapter;
  const testKey = `test-file-${Date.now()}.txt`;
  // The actual upload dir used by the adapter
  const uploadDir = path.join(process.cwd(), 'tmp', 'uploads');

  beforeAll(() => {
    adapter = new LocalAdapter();
  });

  afterAll(async () => {
    // Clean up any test files created during tests
    try {
      await fs.promises.unlink(path.join(uploadDir, testKey));
    } catch {
      // ignore
    }
  });

  describe('generateUploadUrl', () => {
    it('returns an object with url and expiresAt', async () => {
      const spec = await adapter.generateUploadUrl(testKey, 'text/plain', 1024);
      expect(spec).toHaveProperty('url');
      expect(spec).toHaveProperty('expiresAt');
    });

    it('url includes the storage key', async () => {
      const spec = await adapter.generateUploadUrl(testKey, 'image/png', 1024);
      expect(spec.url).toContain(testKey);
    });

    it('expiresAt is in the future', async () => {
      const before = new Date();
      const spec = await adapter.generateUploadUrl(testKey, 'text/plain', 1024);
      expect(spec.expiresAt.getTime()).toBeGreaterThan(before.getTime());
    });

    it('url contains the local-upload path', async () => {
      const spec = await adapter.generateUploadUrl('my-key.pdf', 'application/pdf', 2048);
      expect(spec.url).toContain('local-upload');
    });
  });

  describe('generateDownloadUrl', () => {
    it('returns a string URL containing the key', async () => {
      const url = await adapter.generateDownloadUrl(testKey, 3600);
      expect(typeof url).toBe('string');
      expect(url).toContain(testKey);
    });

    it('url contains the local-download path', async () => {
      const url = await adapter.generateDownloadUrl('some-key.zip', 3600);
      expect(url).toContain('local-download');
    });
  });

  describe('exists', () => {
    it('returns false for a non-existent key', async () => {
      const exists = await adapter.exists(`non-existent-${Date.now()}.txt`);
      expect(exists).toBe(false);
    });

    it('returns true after a file is written to upload dir', async () => {
      const key = `exists-test-${Date.now()}.txt`;
      const filePath = path.join(uploadDir, key);
      try {
        await fs.promises.writeFile(filePath, 'test content');
        const exists = await adapter.exists(key);
        expect(exists).toBe(true);
      } finally {
        await fs.promises.unlink(filePath).catch(() => {});
      }
    });
  });

  describe('delete', () => {
    it('does not throw when deleting a non-existent key (ENOENT)', async () => {
      await expect(adapter.delete(`ghost-file-${Date.now()}.txt`)).resolves.not.toThrow();
    });

    it('removes an existing file', async () => {
      const key = `delete-test-${Date.now()}.txt`;
      const filePath = path.join(uploadDir, key);
      await fs.promises.writeFile(filePath, 'to be deleted');

      await adapter.delete(key);

      const stillExists = await adapter.exists(key);
      expect(stillExists).toBe(false);
    });
  });
});
