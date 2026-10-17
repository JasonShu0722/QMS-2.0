import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import type { FileActor } from '../file-management/file-resource-access.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { adminError } from '../../common/security/admin-mutation.service.js';
import { IdentityService } from './identity.service.js';
import type { UpdateAccountAvatarDto } from './dto/account.dto.js';
import { AccountAvatarFileResourceAdapter } from './account-avatar-file-resource.adapter.js';
import { rethrowSecurityRejection } from '../../common/security/security-rejection.js';

@Injectable()
export class AccountAvatarService {
  constructor(private readonly prisma: PrismaService, private readonly files: FileLifecycleService,
    private readonly audit: AuditLogService, private readonly identity: IdentityService,
    private readonly adapter: AccountAvatarFileResourceAdapter) {}

  async update(actor: FileActor, input: UpdateAccountAvatarDto, key: string | undefined, traceId: string) {
    try {
      if (!key || !/^[A-Za-z0-9._:-]{8,119}$/.test(key)) adminError('IDEMPOTENCY_KEY_REQUIRED', 400);
      const requestDigest = createHash('sha256').update(JSON.stringify({ fileId: input.fileId, expectedVersion: input.expectedVersion })).digest('hex');
      return await this.prisma.$transaction(async (tx) => {
        const resource = { resourceType: 'ACCOUNT_AVATAR', resourceId: actor.id };
        const receiptLock = `account-avatar:${actor.id}:${key}`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${receiptLock}, 0))::text`;
        // assertAttachable owns the resource/file/user lock order, even when removing a reference.
        const attached = await this.files.assertAttachable(tx, actor, resource, input.fileId ? [input.fileId] : []);
        const { user } = await assertActiveAuthentication(tx, actor);
        const receipt = await tx.accountAvatarReceipt.findUnique({ where: { actorUserId_key: { actorUserId: actor.id, key } } });
        if (receipt) {
          if (receipt.requestDigest !== requestDigest) adminError('IDEMPOTENCY_REPLAY', 409);
          return this.identity.profile(actor.id, tx);
        }
        for (const file of attached) this.adapter.validateUpload(file);
        if (user.avatarVersion !== input.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
        await tx.user.update({ where: { id: actor.id }, data: { avatarFileId: input.fileId, avatarVersion: { increment: 1 } } });
        await tx.accountAvatarReceipt.create({ data: { actorUserId: actor.id, key, requestDigest, avatarFileId: input.fileId, avatarVersion: user.avatarVersion + 1 } });
        await this.audit.record({ actorUserId: actor.id, organizationId: actor.organizationId, action: input.fileId ? 'ACCOUNT_AVATAR_SET' : 'ACCOUNT_AVATAR_REMOVED', resourceType: 'User', resourceId: actor.id, outcome: 'SUCCESS', traceId,
          metadata: { avatarFileId: input.fileId, avatarVersion: user.avatarVersion + 1 } }, tx);
        return this.identity.profile(actor.id, tx);
      }, { isolationLevel: 'ReadCommitted' });
    } catch (error) {
      return rethrowSecurityRejection(this.prisma, this.audit, error, { userId: actor.id, resourceType: 'User', resourceId: actor.id, traceId });
    }
  }
}
