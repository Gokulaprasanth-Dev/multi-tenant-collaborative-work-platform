import * as fs from 'fs';
import * as path from 'path';
import { IStorageProvider, UploadSpec } from './storage.interface';

const UPLOAD_DIR = path.join(process.cwd(), 'tmp', 'uploads');
const UPLOAD_TTL_SECONDS = 3600;

export class LocalAdapter implements IStorageProvider {
  constructor() {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  async generateUploadUrl(key: string, _mimeType: string, _maxBytes: number): Promise<UploadSpec> {
    return {
      url: `http://localhost:${process.env.PORT || 3000}/api/v1/files/local-upload/${key}`,
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000),
    };
  }

  async generateDownloadUrl(key: string, _ttlSeconds: number): Promise<string> {
    return `http://localhost:${process.env.PORT || 3000}/api/v1/files/local-download/${key}`;
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(UPLOAD_DIR, key);
    try {
      await fs.promises.unlink(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = path.join(UPLOAD_DIR, key);
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
