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

const configurationTextLimits: Readonly<Record<string, number>> = {
  originalOrganizationCode: 64, originalOrganizationName: 200,
  componentProjectCode: 100, previousComponentProjectCode: 100,
  componentProjectName: 200, previousComponentProjectName: 200,
  componentName: 200, previousComponentName: 200,
  componentCode: 100, previousComponentCode: 100,
  productCategory: 100, previousProductCategory: 100,
  productSubcategory: 100, previousProductSubcategory: 100,
};
const configurationIdKeys = new Set([
  'originalOrganizationId',
  'componentProjectId', 'projectRecordId', 'previousProjectRecordId',
  'customerEngineerAssignmentId', 'previousCustomerEngineerAssignmentId',
  'projectEngineerAssignmentId', 'previousProjectEngineerAssignmentId',
  'departmentId', 'sectionDepartmentId', 'positionId', 'previousPositionId',
  'ministerAssignmentId', 'previousMinisterAssignmentId', 'previousSectionDepartmentId', 'bindingId',
]);
const configurationDateKeys = new Set(['validFrom', 'validTo', 'previousValidFrom', 'previousValidTo']);
const SAFE_METADATA_KEYS = new Set([
  ...Object.keys(configurationTextLimits), ...configurationIdKeys,
  'componentProjectStage', 'previousComponentProjectStage', 'previousStatus',
  ...configurationDateKeys, 'responsibility', 'bindingVersion', 'previousResourceVersion',
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
  'changedFields',
  'structureCode',
  'structurePreviousCode',
  'structureName',
  'structurePreviousName',
  'structureGovernorRoleId',
]);

@Injectable()
export class AuditLogService {
  constructor(@Inject(PrismaService) private readonly prisma: AuditEventWriter) {}

  // Authorized owner transactions ask only whether stable resource history must be retained.
  async hasResourceHistory(transaction: Prisma.TransactionClient, resourceType: string, resourceId: string): Promise<boolean> {
    return !!await transaction.auditEvent.findFirst({ where: { resourceType, resourceId }, select: { id: true } });
  }

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
        .filter(([key, value]) => SAFE_METADATA_KEYS.has(key) && this.isSafeValue(value) && this.isSafeConfigurationValue(key, value)
          && (!['structureCode', 'structurePreviousCode'].includes(key) || (typeof value === 'string' && value.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)))
          && (!['structureName', 'structurePreviousName'].includes(key) || (typeof value === 'string' && value.length <= 200 && /\S/.test(value)))
          && (key !== 'structureGovernorRoleId' || (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))
          && (key !== 'changedFields' || (typeof value === 'string' && /^(fullName|phone|email)(,(fullName|phone|email))*$/.test(value))))
        .map(([key, value]) => [key, value]),
    ) as Prisma.InputJsonObject;
  }

  private isSafeConfigurationValue(key: string, value: Prisma.InputJsonValue | null | undefined): boolean {
    if (Object.hasOwn(configurationTextLimits, key)) {
      if (value === null && ['productCategory', 'previousProductCategory', 'productSubcategory', 'previousProductSubcategory', 'componentName', 'previousComponentName'].includes(key)) return true;
      return typeof value === 'string' && value === value.trim() && value.length > 0 && [...value].length <= configurationTextLimits[key]!;
    }
    if (configurationIdKeys.has(key)) {
      if (value === null && ['projectRecordId', 'previousProjectRecordId', 'customerEngineerAssignmentId', 'previousCustomerEngineerAssignmentId', 'projectEngineerAssignmentId', 'previousProjectEngineerAssignmentId'].includes(key)) return true;
      return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    }
    if (['componentProjectStage', 'previousComponentProjectStage'].includes(key)) return value === 'NEW_PRODUCT' || value === 'MASS_PRODUCTION';
    if (key === 'previousStatus') return value === 'ACTIVE' || value === 'DISABLED';
    if (key === 'responsibility') return value === 'SECTION_MANAGER' || value === 'MINISTER';
    if (key === 'bindingVersion' || key === 'previousResourceVersion') return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
    if (configurationDateKeys.has(key)) {
      if (value === null && ['validTo', 'previousValidTo'].includes(key)) return true;
      if (typeof value !== 'string' || value.length !== 24 || !Number.isFinite(Date.parse(value))) return false;
      return new Date(value).toISOString() === value;
    }
    return true;
  }

  private isSafeValue(value: Prisma.InputJsonValue | null | undefined): boolean {
    if (value === null) return true;
    if (['string', 'number', 'boolean'].includes(typeof value)) return true;
    return false;
  }
}
