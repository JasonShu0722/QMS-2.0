import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { FileResourceAccess, type FileActor, type FileResourceAccessAdapter, type FileResourceRef } from '../file-management/file-resource-access.js';
import { adminError } from '../../common/security/admin-mutation.service.js';

@Injectable()
export class AccountAvatarFileResourceAdapter implements FileResourceAccessAdapter, OnModuleInit {
  readonly resourceType = 'ACCOUNT_AVATAR';
  constructor(private readonly resources: FileResourceAccess) {}
  onModuleInit() { this.resources.register(this); }

  validateUpload(input: { contentType: string; sizeBytes: number }) {
    if (!['image/jpeg', 'image/png'].includes(input.contentType)) adminError('FILE_MIME_NOT_ALLOWED', 400);
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes > 2 * 1024 * 1024) adminError('FILE_TOO_LARGE', 400);
    if (input.sizeBytes < 1) adminError('FILE_EMPTY', 400);
  }

  async quotaFilter(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef): Promise<Prisma.FileObjectWhereInput> {
    await this.authorizeAndLock(tx, actor, resource);
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { avatarFileId: true } });
    return { OR: [
      ...(user.avatarFileId ? [{ id: user.avatarFileId }] : []),
      { status: 'QUARANTINED', scanStatus: { in: ['WAITING_UPLOAD', 'PENDING', 'ERROR'] } },
    ] };
  }

  async authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef) {
    if (resource.resourceType !== this.resourceType || resource.resourceId !== actor.id) adminError('FILE_RESOURCE_DENIED', 403);
    // The lifecycle locks resource -> file -> user, then rechecks authentication. Never lock the user first here.
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { organizationId: true, accountType: true, status: true } });
    if (!user || user.organizationId !== actor.organizationId || user.accountType !== actor.accountType || user.status !== 'ACTIVE') adminError('FILE_RESOURCE_DENIED', 403);
    return { organizationId: user.organizationId, version: 1 };
  }
}
