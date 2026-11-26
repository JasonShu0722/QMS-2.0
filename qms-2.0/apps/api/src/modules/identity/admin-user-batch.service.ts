import { HttpException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { adminError, adminPermissions, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertRecentAuthentication } from '../../common/security/session-security.js';
import { adminMutationDigests, decryptSecret, encryptSecret } from '../../common/security/security-keyring.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { assignSupplierPortalRole, assertSupplierAccountGovernance } from '../authorization/supplier-account-authorization.js';
import { AdminUserService } from './admin-user.service.js';
import { PasswordService } from './password.service.js';
import { TemporaryPasswordService } from './temporary-password.service.js';
import { CreateAdminUserDto } from './dto/admin-user.dto.js';
import type {
  AdminUserBatchConfirmDto, AdminUserBatchConfirmResultDto, AdminUserBatchConfirmResultRowDto, AdminUserBatchPreviewResultDto,
  AdminUserBatchPreviewResultRowDto, AdminUserBatchPreviewRowDto, AdminUserBatchResultDto, AdminUserBatchResultRowDto,
  CreateAdminUserBatchDto, CreateAdminUserBatchPreviewDto,
} from './dto/admin-user-batch.dto.js';
import { PositionGrantCeilingDenied, PositionOnboardingService } from '../organization/position-onboarding.service.js';
import { PLATFORM_ERROR_MESSAGES, type PlatformErrorCode } from '../../common/contracts/platform-error.js';

type Receipt = Omit<AdminUserBatchResultRowDto, 'temporaryPassword'>;
type PreviewRow = AdminUserBatchPreviewResultRowDto;
type ConfirmRow = AdminUserBatchConfirmResultRowDto;
type StoredPreviewRow = { preview: PreviewRow; sealedHash?: string };
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const MANAGEMENT_PERMISSION = 'account:users:create';
const ROW_REJECTIONS = new Set<PlatformErrorCode>([
  'ORGANIZATION_SCOPE_DENIED', 'FEATURE_PERMISSION_DENIED', 'ORGANIZATION_DISABLED',
  'ORGANIZATION_NOT_FOUND', 'ADMIN_ACCOUNT_TYPE_ORGANIZATION_MISMATCH', 'ADMIN_USER_DUPLICATE', 'CONCURRENCY_CONFLICT',
]);

function rowRejection(error: unknown) {
  const code = error instanceof HttpException ? (error.getResponse() as { code?: PlatformErrorCode }).code : undefined;
  return code && ROW_REJECTIONS.has(code) ? code : undefined;
}

function previewCell(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximum + 1) : '';
}

function previewIssue(row: PreviewRow, code: PlatformErrorCode, message = PLATFORM_ERROR_MESSAGES[code]): PreviewRow {
  const display = (value: string) => value.replace(/[\p{Cc}\p{Cs}]/gu, '\uFFFD');
  return { rowNumber: row.rowNumber, username: display(row.username), fullName: display(row.fullName),
    accountType: display(row.accountType), organizationCode: display(row.organizationCode), status: 'SKIPPED', code, message };
}

function initialPasswordContext(previewId: string, rowNumber: number) {
  return `account-batch-preview:${previewId}:${rowNumber}`;
}

@Injectable()
export class AdminUserBatchService {
  constructor(private readonly prisma: PrismaService, private readonly users: AdminUserService, private readonly passwords: PasswordService, private readonly temporary: TemporaryPasswordService, private readonly audit: AuditLogService, private readonly onboarding: PositionOnboardingService) {}

  async preview(actor: AdminActor, input: CreateAdminUserBatchPreviewDto, _traceId: string, key?: string): Promise<AdminUserBatchPreviewResultDto> {
    this.assertKey(key);
    if (new Set(input.rows.map(({ rowNumber }) => rowNumber)).size !== input.rows.length) adminError('ADMIN_BATCH_ROW_INVALID', 400);
    const organizationId = input.organizationId ?? actor.scopeOrganizationId ?? actor.organizationId;
    const identity = { actorId: actor.id, organizationId, key };
    const digests = this.workflowDigests('preview', input.rows.map(({ rowNumber, username, fullName, accountType, organizationCode, password }) =>
      [rowNumber, username, fullName, accountType, organizationCode, password]));
    return this.prisma.$transaction(async (tx) => {
      await this.authorizeWorkflow(tx, actor, organizationId, key);
      const existing = await tx.accountBatch.findUnique({ where: { actorId_organizationId_key: identity }, include: { rows: { orderBy: { rowNumber: 'asc' } } } });
      if (existing) {
        if (!digests.includes(existing.requestDigest)) adminError('IDEMPOTENCY_REPLAY', 409);
        const rows = existing.rows.filter(({ rowNumber }) => rowNumber > 0).map(({ result }) => (result as unknown as StoredPreviewRow).preview);
        for (const [index, row] of rows.entries()) {
          if (!row.organizationId) continue;
          try {
            await this.authorizeTarget(tx, actor, row, 'replay');
          } catch (error) {
            const code = rowRejection(error);
            if (!code) throw error;
            rows[index] = previewIssue(row, code);
          }
        }
        return { previewId: existing.id, expiresAt: new Date(existing.createdAt.getTime() + PREVIEW_TTL_MS).toISOString(), rows };
      }
      const batch = await tx.accountBatch.create({ data: { ...identity, requestDigest: digests[0]! } });
      const seen = new Set<string>();
      const rows: PreviewRow[] = [];
      for (const source of [...input.rows].sort((first, second) => first.rowNumber - second.rowNumber)) {
        const preview = await this.previewRow(tx, actor, source, seen);
        const staged: StoredPreviewRow = { preview };
        if (preview.status === 'READY') {
          seen.add(preview.username.toLowerCase());
          staged.sealedHash = encryptSecret(await this.passwords.hash(source.password), initialPasswordContext(batch.id, source.rowNumber));
        }
        await tx.accountBatchRow.create({ data: { batchId: batch.id, rowNumber: source.rowNumber, result: staged as unknown as Prisma.InputJsonObject } });
        rows.push(preview);
      }
      return { previewId: batch.id, expiresAt: new Date(batch.createdAt.getTime() + PREVIEW_TTL_MS).toISOString(), rows };
    }, { timeout: 60000 });
  }

  async confirm(actor: AdminActor, input: AdminUserBatchConfirmDto, traceId: string, key?: string): Promise<AdminUserBatchConfirmResultDto> {
    this.assertKey(key);
    const organizationId = input.organizationId ?? actor.scopeOrganizationId ?? actor.organizationId;
    const identity = { actorId: actor.id, organizationId, key };
    const digests = this.workflowDigests('confirm', input.previewId);
    const { batchId, rows, expiresAt } = await this.prisma.$transaction(async (tx) => {
      await this.authorizeWorkflow(tx, actor, organizationId, key);
      const existing = await tx.accountBatch.findUnique({ where: { actorId_organizationId_key: identity } });
      if (existing && !digests.includes(existing.requestDigest)) adminError('IDEMPOTENCY_REPLAY', 409);
      const preview = await tx.accountBatch.findFirst({ where: { id: input.previewId, actorId: actor.id, organizationId }, include: { rows: { orderBy: { rowNumber: 'asc' } } } });
      const rows = preview?.rows.filter(({ rowNumber }) => rowNumber > 0).map(({ result }) => (result as unknown as StoredPreviewRow).preview);
      if (!preview || !rows?.length || rows.some((row) => !row) || !rows.some((row) => row.status === 'READY')) adminError('ADMIN_BATCH_ROW_INVALID', 400);
      const expiresAt = preview.createdAt.getTime() + PREVIEW_TTL_MS;
      if (existing) return { batchId: existing.id, rows, expiresAt };
      if (expiresAt <= Date.now()) adminError('ADMIN_BATCH_ROW_INVALID', 409);
      if (preview.rows.some(({ rowNumber }) => rowNumber === 0)) adminError('IDEMPOTENCY_REPLAY', 409);
      const batch = await tx.accountBatch.create({ data: { ...identity, requestDigest: digests[0]! } });
      await tx.accountBatchRow.create({ data: { batchId: preview.id, rowNumber: 0, result: { confirmedBatchId: batch.id } } });
      return { batchId: batch.id, rows, expiresAt };
    });
    const results: ConfirmRow[] = [];
    for (const row of rows) {
      const receipt = { rowNumber: row.rowNumber, username: row.username };
      let creating = false;
      try {
        results.push(await this.prisma.$transaction(async (tx) => {
          await this.authorizeWorkflow(tx, actor, organizationId, key);
          const saved = await tx.accountBatchRow.findUnique({ where: { batchId_rowNumber: { batchId, rowNumber: row.rowNumber } } });
          if (saved) return this.replayConfirmation(tx, actor, row, saved.result as unknown as ConfirmRow);
          let result: ConfirmRow = { ...receipt, status: 'SKIPPED', code: row.code };
          if (row.status === 'READY') {
            await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${row.organizationId}::uuid FOR SHARE`;
            const [stored] = await tx.$queryRaw<Array<{ result: StoredPreviewRow }>>`SELECT result FROM account_batch_rows
              WHERE batch_id = ${input.previewId}::uuid AND row_number = ${row.rowNumber} FOR UPDATE`;
            await this.assertWorkflowAccess(tx, actor, organizationId);
            try {
              await this.authorizeTarget(tx, actor, row);
              await this.assertUsernameAvailable(tx, row.username);
              result = { ...receipt, status: 'SKIPPED' };
            } catch (error) {
              const code = rowRejection(error);
              if (!code) throw error;
              result.code = code;
            }
            if (!result.code) {
              if (expiresAt <= Date.now()) {
                return this.storeConfirmation(tx, batchId, input.previewId, row, { ...receipt, status: 'SKIPPED', code: 'ADMIN_BATCH_ROW_INVALID' });
              }
              creating = true;
              const passwordHash = decryptSecret(stored?.result.sealedHash ?? '', initialPasswordContext(input.previewId, row.rowNumber));
              const accountType = row.accountType === 'SUPPLIER' ? 'SUPPLIER' : 'INTERNAL';
              const configurationRequired = accountType === 'INTERNAL';
              const user = await tx.user.create({ data: {
                organizationId: row.organizationId!, username: row.username, fullName: row.fullName, accountType, passwordHash,
                configurationRequired, status: configurationRequired ? 'DISABLED' : 'ACTIVE',
              } });
              if (accountType === 'SUPPLIER') await assignSupplierPortalRole(tx, user.organizationId, user.id);
              await this.audit.record({ actorUserId: actor.id, organizationId: user.organizationId, action: 'USER_CREATED', resourceType: 'User', resourceId: user.id,
                outcome: 'SUCCESS', traceId, metadata: { batchId, rowNumber: row.rowNumber } }, tx);
              result = { ...receipt, status: 'SUCCESS', userId: user.id, configurationRequired };
            }
          }
          return this.storeConfirmation(tx, batchId, input.previewId, row, result);
        }, { timeout: 15000 }));
      } catch (error) {
        if (!creating) throw error;
        results.push(await this.prisma.$transaction(async (tx) => {
          await this.authorizeWorkflow(tx, actor, organizationId, key);
          const saved = await tx.accountBatchRow.findUnique({ where: { batchId_rowNumber: { batchId, rowNumber: row.rowNumber } } });
          if (saved) return this.replayConfirmation(tx, actor, row, saved.result as unknown as ConfirmRow);
          const duplicate = (error as { code?: string }).code === 'P2002' && await this.usernameExists(tx, row.username);
          const result: ConfirmRow = duplicate ? { ...receipt, status: 'SKIPPED', code: 'ADMIN_USER_DUPLICATE' }
            : { ...receipt, status: 'FAILED', code: rowRejection(error) ?? 'INTERNAL_ERROR' };
          return this.storeConfirmation(tx, batchId, input.previewId, row, result);
        }));
      }
    }
    return { batchId, rows: results };
  }

  purgeExpired() {
    const cutoff = new Date(Date.now() - PREVIEW_TTL_MS);
    return this.prisma.$executeRaw`WITH expired AS MATERIALIZED (
      SELECT staged.batch_id, staged.row_number FROM account_batch_rows staged
      JOIN account_batches batch ON batch.id = staged.batch_id
      WHERE batch.created_at <= ${cutoff} AND staged.result ? 'sealedHash'
      ORDER BY batch.created_at, staged.batch_id, staged.row_number
      LIMIT 1000 FOR UPDATE OF staged SKIP LOCKED
    ) UPDATE account_batch_rows staged SET result = staged.result - 'sealedHash'
      FROM expired WHERE staged.batch_id = expired.batch_id AND staged.row_number = expired.row_number`;
  }

  private assertKey(key: string | undefined): asserts key is string {
    if (!key || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) adminError('IDEMPOTENCY_KEY_REQUIRED', 400);
  }

  private workflowDigests(phase: 'preview' | 'confirm', payload: unknown) {
    const secret = process.env.QMS_RATE_LIMIT_SECRET?.trim() ?? 'qms-development-rate-limit-secret-not-for-production';
    return adminMutationDigests(JSON.stringify({ purpose: `account-batch-${phase}:v1`, payload }), secret);
  }

  private async authorizeWorkflow(tx: AdminTransaction, actor: AdminActor, organizationId: string, key: string) {
    const lock = `account-batch-workflow:${actor.id}:${organizationId}:${key}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))::text`;
    await this.assertWorkflowAccess(tx, actor, organizationId);
  }

  private async assertWorkflowAccess(tx: AdminTransaction, actor: AdminActor, organizationId: string) {
    await assertRecentAuthentication(tx, actor);
    if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
    await assertAdminAccess(tx, actor, organizationId, MANAGEMENT_PERMISSION);
    const scope = await tx.organization.findUnique({ where: { id: organizationId }, select: { status: true, type: true, deletedAt: true, configurationRequired: true } });
    if (scope?.type !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
    if (scope.status !== 'ACTIVE' || scope.deletedAt || scope.configurationRequired) adminError('ORGANIZATION_DISABLED', 403);
  }

  private async authorizeTarget(tx: AdminTransaction, actor: AdminActor, row: PreviewRow, mode: 'validate' | 'replay' = 'validate') {
    const organization = await tx.organization.findUnique({ where: { id: row.organizationId }, select: { code: true, name: true, type: true, status: true, deletedAt: true, configurationRequired: true } });
    if (!organization || organization.deletedAt || (mode === 'validate' && organization.code !== row.organizationCode)) adminError('ORGANIZATION_NOT_FOUND', 404);
    if (organization.type === 'SUPPLIER') await assertSupplierAccountGovernance(tx, actor, row.organizationId!, MANAGEMENT_PERMISSION);
    else await assertAdminAccess(tx, actor, row.organizationId!, MANAGEMENT_PERMISSION);
    if (organization.type !== row.accountType) adminError('ADMIN_ACCOUNT_TYPE_ORGANIZATION_MISMATCH', 400);
    if (organization.status !== 'ACTIVE' || organization.configurationRequired) adminError('ORGANIZATION_DISABLED', 403);
    return organization;
  }

  private async replayConfirmation(tx: AdminTransaction, actor: AdminActor, row: PreviewRow, result: ConfirmRow): Promise<ConfirmRow> {
    if (result.status !== 'SUCCESS') return result;
    try {
      await this.authorizeTarget(tx, actor, row, 'replay');
      return result;
    } catch (error) {
      const code = rowRejection(error);
      if (!code) throw error;
      return { rowNumber: row.rowNumber, username: row.username, status: 'SKIPPED', code };
    }
  }

  private async previewRow(tx: AdminTransaction, actor: AdminActor, source: AdminUserBatchPreviewRowDto, seen: Set<string>): Promise<PreviewRow> {
    const row: PreviewRow = { rowNumber: source.rowNumber, username: previewCell(source.username, 100), fullName: previewCell(source.fullName, 100),
      accountType: previewCell(source.accountType, 16), organizationCode: previewCell(source.organizationCode, 64), status: 'READY' };
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(row.username)) return previewIssue(row, 'ADMIN_BATCH_ROW_INVALID', '用户名须为 1 至 100 位英文字母、数字、点、下划线或连字符');
    if (!row.fullName || row.fullName.length > 100 || /[\p{Cc}\p{Cs}]/u.test(row.fullName)) return previewIssue(row, 'ADMIN_BATCH_ROW_INVALID', '姓名须为 1 至 100 个字符');
    if (row.accountType !== 'INTERNAL' && row.accountType !== 'SUPPLIER') return previewIssue(row, 'ADMIN_BATCH_ROW_INVALID', '账号类型须为内部或供应商');
    if (!row.organizationCode || row.organizationCode.length > 64 || /[\p{Cc}\p{Cs}]/u.test(row.organizationCode)) return previewIssue(row, 'ADMIN_BATCH_ROW_INVALID', '主组织代码须为 1 至 64 个字符');
    const passwordLength = typeof source.password === 'string' && source.password.trim() ? [...source.password].length : 0;
    if (passwordLength < 12 || passwordLength > 256) {
      return previewIssue(row, 'AUTH_PASSWORD_POLICY_INVALID', '密码须为 12 至 256 个字符');
    }
    const target = await tx.organization.findUnique({ where: { code: row.organizationCode }, select: { id: true } });
    if (!target) return previewIssue(row, 'ORGANIZATION_NOT_FOUND');
    try {
      const organization = await this.authorizeTarget(tx, actor, { ...row, organizationId: target.id });
      if (seen.has(row.username.toLowerCase())) adminError('ADMIN_USER_DUPLICATE', 409);
      await this.assertUsernameAvailable(tx, row.username);
      return { ...row, organizationId: target.id, organizationName: organization.name };
    } catch (error) {
      const code = rowRejection(error);
      if (!code) throw error;
      return previewIssue(row, code);
    }
  }

  private async usernameExists(tx: AdminTransaction, username: string) {
    const [row] = await tx.$queryRaw<Array<{ exists: boolean }>>`SELECT EXISTS(SELECT 1 FROM users WHERE lower(btrim(username)) = lower(${username}))`;
    return row?.exists === true;
  }

  private async assertUsernameAvailable(tx: AdminTransaction, username: string) {
    if (await this.usernameExists(tx, username)) adminError('ADMIN_USER_DUPLICATE', 409);
  }

  private async storeConfirmation(tx: AdminTransaction, batchId: string, previewId: string, preview: PreviewRow, result: ConfirmRow) {
    await tx.accountBatchRow.create({ data: { batchId, rowNumber: preview.rowNumber, result: result as unknown as Prisma.InputJsonObject } });
    if (preview.status === 'READY') await tx.accountBatchRow.update({ where: { batchId_rowNumber: { batchId: previewId, rowNumber: preview.rowNumber } },
      data: { result: { preview } as unknown as Prisma.InputJsonObject } });
    return result;
  }

  async create(actor: AdminActor, input: CreateAdminUserBatchDto, traceId: string, key?: string): Promise<AdminUserBatchResultDto> {
    if (!key || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) adminError('IDEMPOTENCY_KEY_REQUIRED', 400);
    if (new Set(input.rows.map((row) => row.rowNumber)).size !== input.rows.length) adminError('ADMIN_BATCH_ROW_INVALID', 400);
    const legacyRows = input.rows.map((row) => ({ rowNumber: row.rowNumber, username: typeof row.username === 'string' ? row.username.trim() : row.username, email: typeof row.email === 'string' ? row.email.trim().toLowerCase() || null : row.email ?? null, accountType: row.accountType }));
    const rows = legacyRows.map((row, index) => ({ ...row, positionIds: input.rows[index]!.positionIds, authorizationBaseline: input.rows[index]!.authorizationBaseline }));
    const secret = process.env.QMS_RATE_LIMIT_SECRET?.trim() ?? 'qms-development-rate-limit-secret-not-for-production';
    const digests = adminMutationDigests(JSON.stringify({ purpose: 'account-batch-initial-positions:v1', organizationId: input.organizationId, rows }), secret);
    const legacyDigests = input.rows.every((row) => row.positionIds === undefined && row.authorizationBaseline === undefined) ? adminMutationDigests(JSON.stringify({ organizationId: input.organizationId, rows: legacyRows }), secret) : [];
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
      if (existing && !digests.includes(existing.requestDigest) && !legacyDigests.includes(existing.requestDigest)) adminError('IDEMPOTENCY_REPLAY', 409);
      return existing ?? transaction.accountBatch.create({ data: { ...identity, requestDigest: digests[0]! } });
    });
    for (const row of rows) {
      try {
        await this.prisma.$transaction(async (transaction) => {
          await authorize(transaction);
          const where = { batchId_rowNumber: { batchId: batch.id, rowNumber: row.rowNumber } };
          const existing = await transaction.accountBatchRow.findUnique({ where });
          if (existing) {
            if ((existing.result as Receipt).status === 'SUCCESS' && row.positionIds !== undefined && row.authorizationBaseline !== undefined) {
              await this.onboarding.authorizeInitialPositions(transaction, actor, input.organizationId, { positionIds: row.positionIds, authorizationBaseline: row.authorizationBaseline });
            }
            return;
          }
          const password = randomBytes(18).toString('base64url');
          const dto = plainToInstance(CreateAdminUserDto, { ...row, organizationId: input.organizationId, initialPassword: password });
          let result: Receipt;
          if (row.accountType !== 'INTERNAL' || validateSync(dto).length) {
            result = { rowNumber: row.rowNumber, username: typeof row.username === 'string' ? row.username.slice(0, 100) : '', status: 'ERROR', code: 'ADMIN_BATCH_ROW_INVALID' };
          } else {
            const user = await this.onboarding.createWithInitialPositions(transaction, actor, input.organizationId, { positionIds: dto.positionIds!, authorizationBaseline: dto.authorizationBaseline! }, traceId, async () => {
              const user = await transaction.user.create({ data: { organizationId: input.organizationId, username: dto.username, email: dto.email, accountType: dto.accountType, mustChangePassword: true, passwordHash: await this.passwords.hash(password) } });
              await this.temporary.store(transaction, user.id, user.credentialVersion, password);
              await this.audit.record({ actorUserId: actor.id, organizationId: input.organizationId, action: 'USER_CREATED', resourceType: 'User', resourceId: user.id, outcome: 'SUCCESS', traceId, metadata: { batchId: batch.id, rowNumber: row.rowNumber } }, transaction);
              return user;
            });
            result = { rowNumber: row.rowNumber, username: user.username, status: 'SUCCESS', userId: user.id, credentialVersion: user.credentialVersion };
          }
          await transaction.accountBatchRow.create({ data: { batchId: batch.id, rowNumber: row.rowNumber, result: result as Prisma.InputJsonObject } });
        }, { timeout: 15000 });
      } catch (error) {
        // Only expected business failures become row receipts; auth, DB and audit failures stop the batch.
        const ceilingDenied = error instanceof PositionGrantCeilingDenied;
        const code = ceilingDenied ? 'FEATURE_PERMISSION_DENIED' : (error as { code?: string }).code === 'P2002' ? 'ADMIN_USER_DUPLICATE' : error instanceof HttpException && [400, 404, 409].includes(error.getStatus()) ? (error.getResponse() as { code?: PlatformErrorCode }).code : undefined;
        if (!code || (!ceilingDenied && !['ADMIN_USER_DUPLICATE', 'STRUCTURE_NOT_FOUND', 'STRUCTURE_DISABLED', 'STRUCTURE_REFERENCE_INVALID', 'CONCURRENCY_CONFLICT', 'ADMIN_PERMISSION_NOT_FOUND', 'ADMIN_ROLE_NOT_FOUND'].includes(code))) throw error;
        await this.prisma.$transaction(async (transaction) => {
          await authorize(transaction);
          const result: Receipt = { rowNumber: row.rowNumber, username: typeof row.username === 'string' ? row.username.slice(0, 100) : '', status: 'ERROR', code };
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
