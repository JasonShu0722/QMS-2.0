import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const SECURITY_AUDIT_ACTIONS = [
  'LOGIN_FAILED',
  'PASSWORD_RESET_REQUESTED',
  'PERMISSION_CHANGED',
  'SESSION_REVOKED',
  'ATTACHMENT_UPLOAD_INITIALIZED',
  'ACTION_REJECTED',
] as const;

type AuditOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';

type AuditMetadata = Record<string, Prisma.InputJsonValue | null | undefined>;

export interface RecordAuditEventInput {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: (typeof SECURITY_AUDIT_ACTIONS)[number] | string;
  resourceType: string;
  resourceId?: string | null;
  outcome: AuditOutcome;
  traceId: string;
  metadata?: AuditMetadata;
}

interface AuditEventWriter {
  auditEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

const SAFE_METADATA_KEYS = new Set([
  'contentType',
  'eventKey',
  'fileId',
  'organizationId',
  'permissionCode',
  'reasonCode',
  'resourceVersion',
  'sha256',
  'sizeBytes',
  'status',
  'targetRoleCode',
  'targetUserId',
  'previousClaimedByUserId',
  'claimedByUserId',
]);

@Injectable()
export class AuditLogService {
  constructor(@Inject(PrismaService) private readonly prisma: AuditEventWriter) {}

  async record(input: RecordAuditEventInput, transaction?: AuditEventWriter): Promise<unknown> {
    const writer = transaction ?? this.prisma;
    return writer.auditEvent.create({
      data: {
        organizationId: input.organizationId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        outcome: input.outcome,
        metadata: this.safeMetadata(input.metadata ?? {}),
        traceId: input.traceId,
      },
    });
  }

  safeMetadata(metadata: AuditMetadata): Prisma.InputJsonObject {
    return Object.fromEntries(
      Object.entries(metadata)
        .filter(([key, value]) => SAFE_METADATA_KEYS.has(key) && this.isSafeValue(value))
        .map(([key, value]) => [key, value]),
    ) as Prisma.InputJsonObject;
  }

  private isSafeValue(value: Prisma.InputJsonValue | null | undefined): boolean {
    if (value === null) return true;
    if (['string', 'number', 'boolean'].includes(typeof value)) return true;
    return false;
  }
}
