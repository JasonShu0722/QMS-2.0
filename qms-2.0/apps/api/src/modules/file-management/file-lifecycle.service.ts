import { randomUUID, createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { FilePolicyService } from './file-policy.service.js';

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
    findUnique(args: { where: { id: string } }): Promise<{ status: FileStatus } | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
  };
}

@Injectable()
export class FileLifecycleService {
  constructor(
    @Inject(PrismaService) private readonly prisma: FileObjectClient,
    private readonly filePolicy: FilePolicyService,
  ) {}

  async initializeUpload(input: InitializeUploadInput): Promise<Record<string, unknown>> {
    this.filePolicy.assertOne({
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });

    const status: FileStatus = input.accountType === 'SUPPLIER' ? 'QUARANTINED' : 'AVAILABLE';
    const objectKey = randomUUID();
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');

    return this.prisma.fileObject.create({
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
  }

  async assertDownloadable(fileId: string): Promise<{ status: FileStatus }> {
    const file = await this.prisma.fileObject.findUnique({
      where: { id: fileId },
    });
    if (!file || file.status !== 'AVAILABLE') throw new Error('FILE_NOT_AVAILABLE');
    return file;
  }

  async deleteLogically(fileId: string): Promise<Record<string, unknown>> {
    return this.prisma.fileObject.update({
      where: { id: fileId },
      data: { status: 'DELETED' },
    });
  }
}
