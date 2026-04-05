export interface UploadSpec {
  url: string;
  fields?: Record<string, string>; // S3 presigned POST form fields
  expiresAt: Date;
}

export interface IStorageProvider {
  generateUploadUrl(key: string, mimeType: string, maxBytes: number): Promise<UploadSpec>;
  generateDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
