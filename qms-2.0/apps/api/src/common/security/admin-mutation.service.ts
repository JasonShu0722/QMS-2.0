import { HttpException, Injectable, Module } from '@nestjs/common';
import { adminMutationDigests } from './security-keyring.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditLogModule } from '../../modules/audit-log/audit-log.module.js';
import { AuditLogService } from '../../modules/audit-log/audit-log.service.js';
import { PLATFORM_ERROR_MESSAGES, type PlatformErrorCode } from '../contracts/platform-error.js';
import { assertRecentAuthentication, isSecurityConcurrencyConflict } from './session-security.js';

export type AdminActor = { id: string; sessionId: string; organizationId: string; accountType: 'INTERNAL' | 'SUPPLIER'; scopeOrganizationId?: string };
export type AdminTransaction = Prisma.TransactionClient;
export { ADMIN_PERMISSIONS } from '../../modules/authorization/permission-catalog.js';

export function adminError(code: PlatformErrorCode, status: number): never {
  throw new HttpException({ code, message: PLATFORM_ERROR_MESSAGES[code] }, status);
}

export async function adminPermissions(transaction: AdminTransaction, userId: string, organizationId: string): Promise<string[]> {
  const assignments = await transaction.userRole.findMany({ where: { userId, organizationId }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return [...new Set(assignments.flatMap((assignment) => assignment.role.permissions.map((entry) => entry.permission.code)))].sort();
}

export async function assertAdminAccess(transaction: AdminTransaction, actor: AdminActor, organizationId: string, permission: string | string[]): Promise<string[]> {
  const current = await transaction.user.findUnique({ where: { id: actor.id }, select: { status: true, accountType: true, organizationId: true, organization: { select: { status: true } } } });
  if (!current || current.status !== 'ACTIVE' || current.accountType !== actor.accountType || current.organizationId !== actor.organizationId) adminError('AUTH_SESSION_REQUIRED', 401);
  if (current.organization.status !== 'ACTIVE') adminError('ORGANIZATION_DISABLED', 403);
  if (current.accountType === 'SUPPLIER' && organizationId !== current.organizationId) adminError('ORGANIZATION_SCOPE_DENIED', 403);
  const granted = await adminPermissions(transaction, actor.id, organizationId);
  if ((Array.isArray(permission) ? permission : [permission]).some((code) => !granted.includes(code))) adminError('FEATURE_PERMISSION_DENIED', 403);
  const target = await transaction.organization.findUnique({ where: { id: organizationId }, select: { status: true } });
  if (!target) adminError('ORGANIZATION_NOT_FOUND', 404);
  if (target.status !== 'ACTIVE' && !(Array.isArray(permission) ? permission : [permission]).every((code) => ['organization:manage', 'organization:read'].includes(code)) ) adminError('ORGANIZATION_DISABLED', 403);
  return granted;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([first], [second]) => first.localeCompare(second)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

@Injectable()
export class AdminMutationService {
  private readonly secret: string;

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {
    const configured = process.env.QMS_RATE_LIMIT_SECRET?.trim();
    if (!configured && process.env.NODE_ENV === 'production') throw new Error('QMS_RATE_LIMIT_SECRET must be configured in production');
    this.secret = configured ?? 'qms-development-rate-limit-secret-not-for-production';
  }

  async run<Result>(input: { actor: AdminActor; organizationId: string; key: string | undefined; action: string; payload: unknown; permission: string | string[]; traceId: string; duplicateCode?: PlatformErrorCode; additionalAccess?: { organizationId: string; permission: string }[] }, work: (transaction: AdminTransaction, granted: string[]) => Promise<Result>): Promise<Result> {
    try {
      if (!input.key || !/^[a-zA-Z0-9._:-]{8,128}$/.test(input.key)) adminError('IDEMPOTENCY_KEY_REQUIRED', 400);
      const key = input.key;
      const requestDigests = adminMutationDigests(canonical(input.payload), this.secret);
      const requestDigest = requestDigests[0]!;
      return await this.prisma.$transaction(async (transaction) => {
        await assertRecentAuthentication(transaction, input.actor);
        const granted = await assertAdminAccess(transaction, input.actor, input.organizationId, input.permission);
        for (const access of input.additionalAccess ?? []) await assertAdminAccess(transaction, input.actor, access.organizationId, access.permission);
        const identity = { actorUserId: input.actor.id, organizationId: input.organizationId, key };
        const existing = await transaction.adminMutation.findUnique({ where: { actorUserId_organizationId_key: identity } });
        if (existing) {
          if (existing.action !== input.action || !requestDigests.includes(existing.requestDigest)) adminError('IDEMPOTENCY_REPLAY', 409);
          return (existing.response as { value: Result }).value;
        }
        const result = await work(transaction, granted);
        const response = JSON.parse(JSON.stringify({ value: result ?? null })) as Prisma.InputJsonObject;
        await transaction.adminMutation.create({ data: { ...identity, action: input.action, requestDigest, response } });
        return (response as { value: Result }).value;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      const code = (error as { code?: string }).code;
      const mappedCode = isSecurityConcurrencyConflict(error) ? 'CONCURRENCY_CONFLICT' : code === 'P2002' ? input.duplicateCode ?? 'CONCURRENCY_CONFLICT' : undefined;
      const rejection = mappedCode ? new HttpException({ code: mappedCode, message: PLATFORM_ERROR_MESSAGES[mappedCode] }, 409) : error;
      if (rejection instanceof HttpException && [400, 401, 403, 404, 409].includes(rejection.getStatus())) {
        await this.audit.record({ actorUserId: input.actor.id, organizationId: input.organizationId, action: 'ACTION_REJECTED', resourceType: 'Administration', outcome: 'DENIED', traceId: input.traceId, metadata: { permissionCode: Array.isArray(input.permission) ? input.permission.join(',') : input.permission, reasonCode: (rejection.getResponse() as { code: string }).code } });
      }
      throw rejection;
    }
  }
}

@Module({ imports: [AuditLogModule], providers: [AdminMutationService], exports: [AdminMutationService] })
export class AdminMutationModule {}
