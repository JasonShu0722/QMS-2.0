import { Injectable } from '@nestjs/common';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

export interface UploadUrl {
  objectKey: string;
  url: string;
  headers: Record<string, string>;
}

export interface ObjectStorage {
  createUploadUrl(objectKey: string, contentType: string): Promise<UploadUrl>;
  head(objectKey: string): Promise<{ sizeBytes: number; contentType: string; versionId: string; retainUntil: Date | null }>;
  readVersion(objectKey: string, versionId: string, maxBytes: number): AsyncIterable<Uint8Array>;
  createDownloadUrl(objectKey: string, versionId: string, originalName: string): Promise<string>;
}

export const OBJECT_STORAGE = Symbol('QMS_OBJECT_STORAGE');

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class S3CompatibleObjectStorage implements ObjectStorage {
  async createUploadUrl(objectKey: string, contentType: string): Promise<UploadUrl> {
    this.assertObjectKey(objectKey);
    const { client, bucket } = this.connection();
    try {
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: objectKey, ContentType: contentType, IfNoneMatch: '*' }), { expiresIn: 60, signableHeaders: new Set(['content-type', 'if-none-match']) });
      return { objectKey, url, headers: { 'content-type': contentType, 'if-none-match': '*' } };
    } finally { client.destroy(); }
  }

  async head(objectKey: string) {
    this.assertObjectKey(objectKey);
    const { client, bucket } = this.connection();
    try {
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }), { abortSignal: AbortSignal.timeout(10000) });
      if (!result.VersionId || result.VersionId === 'null' || !Number.isSafeInteger(result.ContentLength) || !result.ContentType) throw new Error('FILE_OBJECT_INVALID');
      return { sizeBytes: result.ContentLength!, contentType: result.ContentType, versionId: result.VersionId, retainUntil: result.ObjectLockRetainUntilDate ?? null };
    } finally { client.destroy(); }
  }

  async *readVersion(objectKey: string, versionId: string, maxBytes: number): AsyncGenerator<Uint8Array> {
    this.assertObjectKey(objectKey);
    this.assertVersion(versionId);
    const { client, bucket } = this.connection();
    const signal = AbortSignal.timeout(30000);
    let body: Readable | undefined;
    const abort = () => body?.destroy(new Error('FILE_OBJECT_TIMEOUT'));
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey, VersionId: versionId }), { abortSignal: signal });
      if (result.VersionId !== versionId || !result.Body || !Number.isSafeInteger(result.ContentLength) || result.ContentLength! > maxBytes) throw new Error('FILE_OBJECT_INVALID');
      body = result.Body as Readable;
      signal.addEventListener('abort', abort, { once: true });
      let received = 0;
      for await (const chunk of body) {
        if (!(chunk instanceof Uint8Array)) throw new Error('FILE_OBJECT_INVALID');
        received += chunk.byteLength;
        if (received > maxBytes || signal.aborted) throw new Error('FILE_OBJECT_LIMIT');
        yield chunk;
      }
      if (received !== result.ContentLength) throw new Error('FILE_OBJECT_TRUNCATED');
    } finally { signal.removeEventListener('abort', abort); body?.destroy(); client.destroy(); }
  }

  async createDownloadUrl(objectKey: string, versionId: string, originalName: string): Promise<string> {
    this.assertObjectKey(objectKey);
    this.assertVersion(versionId);
    const { client, bucket } = this.connection();
    const encoded = encodeURIComponent(originalName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    try {
      return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: objectKey, VersionId: versionId,
        ResponseContentDisposition: `attachment; filename="download"; filename*=UTF-8''${encoded}`, ResponseContentType: 'application/octet-stream' }), { expiresIn: 60 });
    } finally { client.destroy(); }
  }

  private connection() {
    const endpoint = process.env.QMS_OBJECT_STORAGE_ENDPOINT;
    const bucket = process.env.QMS_OBJECT_STORAGE_BUCKET;
    const accessKeyId = process.env.QMS_OBJECT_STORAGE_ACCESS_KEY;
    const secretAccessKey = process.env.QMS_OBJECT_STORAGE_SECRET_KEY;
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error('OBJECT_STORAGE_CONFIGURATION_REQUIRED');
    const parsed = new URL(endpoint);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || !/^\/[\s]*$/.test(parsed.pathname)) throw new Error('OBJECT_STORAGE_ENDPOINT_INVALID');
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') throw new Error('OBJECT_STORAGE_TLS_REQUIRED');
    const client = new S3Client({ endpoint, region: process.env.QMS_OBJECT_STORAGE_REGION ?? 'us-east-1', forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId, secretAccessKey } });
    return { client, bucket };
  }

  private assertObjectKey(objectKey: string): void {
    if (!UUID_V4_PATTERN.test(objectKey)) throw new Error('OBJECT_KEY_MUST_BE_UUID');
  }

  private assertVersion(versionId: string): void {
    if (!versionId || versionId === 'null' || versionId.length > 1024) throw new Error('FILE_OBJECT_VERSION_REQUIRED');
  }
}

export const LocalMinioObjectStorage = S3CompatibleObjectStorage;

export function createObjectStorage(): ObjectStorage {
  const provider = process.env.QMS_OBJECT_STORAGE_PROVIDER ?? 'minio';
  if (provider !== 'minio' && provider !== 's3') {
    throw new Error('OBJECT_STORAGE_PROVIDER_UNSUPPORTED');
  }
  return new S3CompatibleObjectStorage();
}
