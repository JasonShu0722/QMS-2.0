import { randomUUID, createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { FilePolicyService } from './file-policy.service.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
  type UploadUrl,
} from './object-storage.service.js';

type AccountType = 'INTERNAL' | 'SUPPLIER';
type FileStatus = 'QUARANTINED' | 'AVAILABLE' | 'DELETED';

export interface InitializeUploadInput {
  accountType: AccountType;
  organizationId: string;
  uploadedById: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  bytes: Buffer;
  resourceType?: string;
  resourceId?: string;
}

interface FileObjectClient {
  fileObject: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findUnique(args: { where: { id: string } }): Promise<Record<string, unknown> | null>;
    updateMany(args: {
      where: { id: string; status: FileStatus };
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
  };
}

export interface InitializeUploadResult {
  fileId: string;
  status: FileStatus;
  uploadUrl: string;
  headers: Record<string, string>;
  objectKey: string;
  metadata: {
    originalName: string;
    contentType: string;
    sizeBytes: number | string;
    resourceType: string | null;
    resourceId: string | null;
  };
}

export interface FileScanResult {
  clean: boolean;
  scanner: string;
  reason?: string;
}

@Injectable()
export class FileLifecycleService {
  constructor(
    @Inject(PrismaService) private readonly prisma: FileObjectClient,
    private readonly filePolicy: FilePolicyService,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
  ) {}

  async initializeUpload(input: InitializeUploadInput): Promise<InitializeUploadResult> {
    this.filePolicy.assertOne({
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });

    const status: FileStatus = input.accountType === 'SUPPLIER' ? 'QUARANTINED' : 'AVAILABLE';
    const objectKey = randomUUID();
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const upload = await this.objectStorage.createUploadUrl(objectKey, input.contentType);
    this.assertUploadBoundToObjectKey(upload, objectKey);

    const metadata = await this.prisma.fileObject.create({
      data: {
        organizationId: input.organizationId,
        objectKey,
        originalName: input.originalName,
        contentType: input.contentType,
        sizeBytes: BigInt(input.sizeBytes),
        sha256,
        status,
        version: 1,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        uploadedById: input.uploadedById,
      },
    });

    return {
      fileId: String(metadata.id),
      status,
      uploadUrl: upload.url,
      headers: upload.headers,
      objectKey,
      metadata: {
        originalName: String(metadata.originalName),
        contentType: String(metadata.contentType),
        sizeBytes: this.toJsonSafeSize(metadata.sizeBytes),
        resourceType: metadata.resourceType === null ? null : String(metadata.resourceType),
        resourceId: metadata.resourceId === null ? null : String(metadata.resourceId),
      },
    };
  }

  async assertDownloadable(fileId: string): Promise<Record<string, unknown>> {
    const file = await this.prisma.fileObject.findUnique({
      where: { id: fileId },
    });
    if (!file || file.status !== 'AVAILABLE') throw new Error('FILE_NOT_AVAILABLE');
    return file;
  }

  async markAvailableAfterScan(
    fileId: string,
    scanResult: FileScanResult,
  ): Promise<Record<string, unknown>> {
    if (!scanResult.clean) throw new Error('FILE_SCAN_REJECTED');

    const transition = await this.prisma.fileObject.updateMany({
      where: { id: fileId, status: 'QUARANTINED' },
      data: { status: 'AVAILABLE' },
    });
    if (transition.count !== 1) throw new Error('FILE_SCAN_TRANSITION_REJECTED');

    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file) throw new Error('FILE_NOT_FOUND');
    return file;
  }

  async deleteLogically(fileId: string): Promise<Record<string, unknown>> {
    return this.prisma.fileObject.update({
      where: { id: fileId },
      data: { status: 'DELETED' },
    });
  }

  private assertUploadBoundToObjectKey(upload: UploadUrl, objectKey: string): void {
    if (upload.objectKey !== objectKey) throw new Error('UPLOAD_URL_OBJECT_KEY_MISMATCH');
  }

  private toJsonSafeSize(sizeBytes: unknown): number | string {
    if (typeof sizeBytes === 'bigint') {
      if (sizeBytes <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(sizeBytes);
      return sizeBytes.toString();
    }
    if (typeof sizeBytes === 'number') return sizeBytes;
    return String(sizeBytes);
  }
}
