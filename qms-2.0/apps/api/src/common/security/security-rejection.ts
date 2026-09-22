import { HttpException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service.js';
import type { AuditLogService } from '../../modules/audit-log/audit-log.service.js';
import { isSecurityConcurrencyConflict } from './session-security.js';

export async function rethrowSecurityRejection(
  prisma: PrismaService,
  audit: AuditLogService,
  error: unknown,
  input: { userId: string; resourceType: string; resourceId: string; traceId: string; duplicateCode?: string; action?: 'ACTION_REJECTED' | 'LOGIN_FAILED'; outcome?: 'DENIED' | 'FAILURE' },
): Promise<never> {
  const mappedCode = isSecurityConcurrencyConflict(error) ? 'CONCURRENCY_CONFLICT'
    : (error as { code?: string }).code === 'P2002' ? input.duplicateCode : undefined;
  const rejection = mappedCode ? new HttpException({ code: mappedCode, message: mappedCode }, 409) : error;
  if (rejection instanceof HttpException && rejection.getStatus() < 500) {
    const reasonCode = (rejection.getResponse() as { code?: string }).code;
    if (reasonCode) {
      const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, organizationId: true } });
      await audit.record({ actorUserId: user?.id, organizationId: user?.organizationId, action: input.action ?? 'ACTION_REJECTED', resourceType: input.resourceType, resourceId: input.resourceId, outcome: input.outcome ?? 'DENIED', traceId: input.traceId, metadata: { reasonCode } });
    }
  }
  throw rejection;
}
