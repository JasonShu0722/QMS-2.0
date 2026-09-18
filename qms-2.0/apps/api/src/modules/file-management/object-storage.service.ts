import { Injectable } from '@nestjs/common';

export interface UploadUrl {
  objectKey: string;
  url: string;
  headers: Record<string, string>;
}

export interface ObjectStorage {
  createUploadUrl(objectKey: string, contentType: string): Promise<UploadUrl>;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class S3CompatibleObjectStorage implements ObjectStorage {
  async createUploadUrl(objectKey: string, contentType: string): Promise<UploadUrl> {
    this.assertObjectKey(objectKey);
    const endpoint = process.env.QMS_OBJECT_STORAGE_ENDPOINT ?? 'http://localhost:9000';
    const bucket = process.env.QMS_OBJECT_STORAGE_BUCKET ?? 'qms-foundation';
    return {
      objectKey,
      url: `${endpoint.replace(/\/$/, '')}/${bucket}/${objectKey}`,
      headers: { 'content-type': contentType },
    };
  }

  private assertObjectKey(objectKey: string): void {
    if (!UUID_V4_PATTERN.test(objectKey)) throw new Error('OBJECT_KEY_MUST_BE_UUID');
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
