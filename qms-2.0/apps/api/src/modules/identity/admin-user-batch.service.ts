import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { adminError, adminPermissions, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertRecentAuthentication } from '../../common/security/session-security.js';
import { adminMutationDigests } from '../../common/security/security-keyring.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { AdminUserService } from './admin-user.service.js';
import { PasswordService } from './password.service.js';
import { TemporaryPasswordService } from './temporary-password.service.js';
import { CreateAdminUserDto } from './dto/admin-user.dto.js';
import type { AdminUserBatchResultDto, AdminUserBatchResultRowDto, CreateAdminUserBatchDto } from './dto/admin-user-batch.dto.js';

type Receipt = Omit<AdminUserBatchResultRowDto, 'temporaryPassword'>;

@Injectable()
export class AdminUserBatchService {
  constructor(private readonly prisma: PrismaService, private readonly users: AdminUserService, private readonly passwords: PasswordService, private readonly temporary: TemporaryPasswordService, private readonly audit: AuditLogService) {}

  async create(actor: AdminActor, input: CreateAdminUserBatchDto, traceId: string, key?: string): Promise<AdminUserBatchResultDto> {
    if (!key || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) adminError('IDEMPOTENCY_KEY_REQUIRED', 400);
    if (new Set(input.rows.map((row) => row.rowNumber)).size !== input.rows.length) adminError('ADMIN_BATCH_ROW_INVALID', 400);
    const rows = input.rows.map((row) => ({ rowNumber: row.rowNumber, username: typeof row.username === 'string' ? row.username.trim() : row.username, email: typeof row.email === 'string' ? row.email.trim().toLowerCase() || null : row.email ?? null, accountType: row.accountType }));
    const digests = adminMutationDigests(JSON.stringify({ organizationId: input.organizationId, rows }), process.env.QMS_RATE_LIMIT_SECRET?.trim() ?? 'qms-development-rate-limit-secret-not-for-production');
    const identity = { actorId: actor.id, organizationId: input.organizationId, key };
    const lock = `account-batch:${actor.id}:${input.organizationId}:${key}`;
    const authorize = async (transaction: AdminTransaction) => {
      await assertRecentAuthentication(transaction, actor);
      await assertAdminAccess(transaction, actor, input.organizationId, 'account:users:create');
      await this.users.assertOrganizationAccountType(transaction, input.organizationId, 'INTERNAL');
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))::text`;
    };
    const batch = await this.prisma.$transaction(async (transaction) => {
      await authorize(transaction);
      const existing = await transaction.accountBatch.findUnique({ where: { actorId_organizationId_key: identity } });
      if (existing && !digests.includes(existing.requestDigest)) adminError('IDEMPOTENCY_REPLAY', 409);
      return existing ?? transaction.accountBatch.create({ data: { ...identity, requestDigest: digests[0]! } });
    });
    for (const row of rows) {
      try {
        await this.prisma.$transaction(async (transaction) => {
          await authorize(transaction);
          const where = { batchId_rowNumber: { batchId: batch.id, rowNumber: row.rowNumber } };
          if (await transaction.accountBatchRow.findUnique({ where })) return;
          const password = randomBytes(18).toString('base64url');
          const dto = plainToInstance(CreateAdminUserDto, { ...row, organizationId: input.organizationId, initialPassword: password });
          let result: Receipt;
          if (row.accountType !== 'INTERNAL' || validateSync(dto).length) {
            result = { rowNumber: row.rowNumber, username: typeof row.username === 'string' ? row.username.slice(0, 100) : '', status: 'ERROR', code: 'ADMIN_BATCH_ROW_INVALID' };
          } else {
            const user = await transaction.user.create({ data: { organizationId: input.organizationId, username: dto.username, email: dto.email, accountType: dto.accountType, mustChangePassword: true, passwordHash: await this.passwords.hash(password) } });
            await this.temporary.store(transaction, user.id, user.credentialVersion, password);
            await this.audit.record({ actorUserId: actor.id, organizationId: input.organizationId, action: 'USER_CREATED', resourceType: 'User', resourceId: user.id, outcome: 'SUCCESS', traceId, metadata: { batchId: batch.id, rowNumber: row.rowNumber } }, transaction);
            result = { rowNumber: row.rowNumber, username: user.username, status: 'SUCCESS', userId: user.id, credentialVersion: user.credentialVersion };
          }
          await transaction.accountBatchRow.create({ data: { batchId: batch.id, rowNumber: row.rowNumber, result: result as Prisma.InputJsonObject } });
        }, { timeout: 15000 });
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
        await this.prisma.$transaction(async (transaction) => {
          await authorize(transaction);
          const result: Receipt = { rowNumber: row.rowNumber, username: row.username, status: 'ERROR', code: 'ADMIN_USER_DUPLICATE' };
          await transaction.accountBatchRow.upsert({ where: { batchId_rowNumber: { batchId: batch.id, rowNumber: row.rowNumber } }, update: {}, create: { batchId: batch.id, rowNumber: row.rowNumber, result: result as Prisma.InputJsonObject } });
        });
      }
    }
    // Historical receipts contain only metadata; secrets are always projected from current state.
    return this.prisma.$transaction(async (transaction) => {
      await authorize(transaction);
      const canReadTemporaryPasswords = (await adminPermissions(transaction, actor.id, input.organizationId)).includes('account:users:reset');
      const stored = await transaction.accountBatchRow.findMany({ where: { batchId: batch.id } });
      const receipts = new Map(stored.map((row) => [row.rowNumber, row.result as Receipt]));
      const result: AdminUserBatchResultRowDto[] = [];
      for (const row of rows) {
        const receipt = receipts.get(row.rowNumber)!;
        if (receipt.status === 'SUCCESS' && receipt.userId) {
          if (canReadTemporaryPasswords) {
            await this.users.assertTemporaryPasswordTarget(transaction, actor, receipt.userId, input.organizationId);
            result.push({ ...receipt, temporaryPassword: await this.temporary.project(transaction, receipt.userId, receipt.credentialVersion) });
            await this.audit.record({ actorUserId: actor.id, organizationId: input.organizationId, action: 'TEMPORARY_PASSWORD_READ', resourceType: 'User', resourceId: receipt.userId, outcome: 'SUCCESS', traceId }, transaction);
          } else result.push({ ...receipt, temporaryPassword: { userId: receipt.userId, status: 'UNAVAILABLE' } });
        } else result.push(receipt);
      }
      return { batchId: batch.id, rows: result };
    }, { timeout: 15000 });
  }
}
