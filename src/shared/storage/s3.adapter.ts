import { S3Client, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { config } from '../config';
import { IStorageProvider, UploadSpec } from './storage.interface';

export class S3Adapter implements IStorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.client = new S3Client({
      region: config.awsRegion ?? 'ap-south-1',
      // When AWS_S3_ENDPOINT is set (e.g. MinIO), override the endpoint and
      // use path-style addressing — MinIO does not support virtual-hosted style.
      ...(config.awsS3Endpoint && {
        endpoint: config.awsS3Endpoint,
        forcePathStyle: true,
      }),
    });
    this.bucket = config.awsS3Bucket!;
  }

  async generateUploadUrl(key: string, mimeType: string, maxBytes: number): Promise<UploadSpec> {
    // NOT getSignedUrl + PutObjectCommand — presigned POST enforces content-length-range at S3 layer
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, maxBytes],
        ['eq', '$Content-Type', mimeType],
      ],
      Fields: { 'Content-Type': mimeType },
      Expires: 900,
    });
    return { url, fields, expiresAt: new Date(Date.now() + 900_000) };
  }

  async generateDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
