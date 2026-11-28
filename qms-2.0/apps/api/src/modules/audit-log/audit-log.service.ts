import { Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { aiApplicationTestMetadata } from './ai-application-test.read-model.js';

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

export const PROCESS_DEFECT_MANUAL_UPDATE = 'PROCESS_DEFECT_MANUAL_UPDATE_RECORDED';

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
  deletionReason: 300,
  ingestionReason: 300,
  originalOrganizationCode: 64, originalOrganizationName: 200,
  componentProjectCode: 100, previousComponentProjectCode: 100,
  componentProjectName: 200, previousComponentProjectName: 200,
  componentName: 200, previousComponentName: 200,
  componentCode: 100, previousComponentCode: 100,
  productCategory: 100, previousProductCategory: 100,
  productSubcategory: 100, previousProductSubcategory: 100,
};
const configurationIdKeys = new Set([
  'jobId', 'ruleId',
  'endpointId', 'credentialId', 'receiptId',
  'originalOrganizationId',
  'componentProjectId', 'projectRecordId', 'previousProjectRecordId',
  'customerEngineerAssignmentId', 'previousCustomerEngineerAssignmentId',
  'projectEngineerAssignmentId', 'previousProjectEngineerAssignmentId',
  'departmentId', 'sectionDepartmentId', 'positionId', 'previousPositionId',
  'ministerAssignmentId', 'previousMinisterAssignmentId', 'previousSectionDepartmentId', 'bindingId',
]);
const configurationDateKeys = new Set(['validFrom', 'validTo', 'previousValidFrom', 'previousValidTo']);
const eightDReportPrefixes: Readonly<Record<string, string>> = {
  ProcessEightDReport: 'PROCESS_EIGHT_D', CustomerEightDReport: 'CUSTOMER_EIGHT_D', NewProductEightDReport: 'NEW_PRODUCT_EIGHT_D',
};
const SAFE_METADATA_KEYS = new Set([
  'protocol', 'publishedVersion',
  'materialId', 'materialVersion', 'materialMatched',
  'rowIndex', 'ruleVersion', 'receiptCount', 'rowCount', 'cancelledJobCount', 'result', 'target', 'action', 'enabled', 'reprocessed',
  ...Object.keys(configurationTextLimits), ...configurationIdKeys,
  'componentProjectStage', 'previousComponentProjectStage', 'previousStatus',
  ...configurationDateKeys, 'responsibility', 'bindingVersion', 'previousResourceVersion',
  'contentType',
  'returnReceipt',
  'capacityBytes',
  'previousCapacityBytes',
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

  async readSuccessfulResourceMetadata(transaction: Prisma.TransactionClient, scope: { organizationId: string; actorUserId: string; action: string; resourceType: string; resourceId: string }) {
    const event = await transaction.auditEvent.findFirst({ where: { ...scope, outcome: 'SUCCESS' }, select: { metadata: true } });
    return event?.metadata;
  }

  readSuccessfulResourceEvents(transaction: Prisma.TransactionClient,
    scope: { organizationId: string; action: string | string[]; resourceType: string; resourceId: string }, take?: number) {
    return transaction.auditEvent.findMany({
      where: { ...scope, action: typeof scope.action === 'string' ? scope.action : { in: scope.action }, outcome: 'SUCCESS' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(take === undefined ? {} : { take }),
      select: { id: true, action: true, actorUserId: true, createdAt: true, metadata: true, actor: { select: { fullName: true, username: true } } },
    });
  }

  async record(input: RecordAuditEventInput, transaction?: AuditEventWriter): Promise<unknown> {
    const writer = transaction ?? this.prisma;
    return writer.auditEvent.create({ data: this.eventData(input) });
  }

  async recordMany(inputs: readonly RecordAuditEventInput[], transaction: Pick<Prisma.TransactionClient, 'auditEvent'>): Promise<void> {
    await transaction.auditEvent.createMany({ data: inputs.map(input => this.eventData(input)) });
  }

  private eventData(input: RecordAuditEventInput) {
    return {
      organizationId: input.organizationId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      outcome: input.outcome,
      metadata: this.safeMetadata(input.metadata ?? {}, input),
      traceId: input.traceId,
    };
  }

  safeMetadata(metadata: AuditMetadata, event?: { action: string; resourceType: string; outcome: string }): Prisma.InputJsonObject {
    const trialFields = event?.action === 'AI_APPLICATION_TESTED' && event.resourceType === 'AiApplication' && (event.outcome === 'SUCCESS' || event.outcome === 'FAILURE')
      ? Object.entries(aiApplicationTestMetadata(metadata)).filter(([, value]) => value !== null) : [];
    const workbenchStatusChange = event?.action === 'WORKBENCH_GRAPH_STATUS_UPDATED' && event.resourceType === 'WorkbenchGraphNode' && event.outcome === 'SUCCESS';
    const processDefectWrite = event?.resourceType === 'ProcessDefect' && event.outcome === 'SUCCESS'
      && ['PROCESS_DEFECT_CREATED', 'PROCESS_DEFECT_UPDATED', 'PROCESS_DEFECT_INGESTION_CREATED', 'PROCESS_DEFECT_INGESTION_UPDATED'].includes(event.action);
    const manualProcessDefectUpdate = event?.action === PROCESS_DEFECT_MANUAL_UPDATE && event.resourceType === 'ProcessDefect' && event.outcome === 'SUCCESS';
    const eightDReportPrefix = event?.outcome === 'SUCCESS' && Object.hasOwn(eightDReportPrefixes, event.resourceType)
      ? eightDReportPrefixes[event.resourceType] : undefined;
    return Object.fromEntries(
      Object.entries(metadata)
        .filter(([key, value]) => {
          if (eightDReportPrefix && event?.action === `${eightDReportPrefix}_RISK` && (key === 'previousSeverity' || key === 'severity')) {
            return typeof value === 'string' && ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(value);
          }
          if (eightDReportPrefix && event?.action === `${eightDReportPrefix}_SOURCES` && ['addedSourceIds', 'removedSourceIds', 'sourceHistoryIds'].includes(key)) {
            return Array.isArray(value) && value.length <= (key === 'sourceHistoryIds' ? 200 : 100) && value.every(id => typeof id === 'string' && isUUID(id));
          }
          if (workbenchStatusChange) {
            if (key === 'status' || key === 'previousStatus') return value === 'idea' || value === 'development' || value === 'live';
            if (key === 'evidence') return typeof value === 'string' && value === value.trim() && value.length > 0 && [...value].length <= 500 && !value.includes('\u0000');
          }
          return SAFE_METADATA_KEYS.has(key) && this.isSafeValue(value) && this.isSafeConfigurationValue(key, value)
          && (!['structureCode', 'structurePreviousCode'].includes(key) || (typeof value === 'string' && value.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)))
          && (!['structureName', 'structurePreviousName'].includes(key) || (typeof value === 'string' && value.length <= 200 && /\S/.test(value)))
          && (key !== 'structureGovernorRoleId' || (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))
          && (key !== 'changedFields' || (typeof value === 'string' && (/^(fullName|phone|email)(,(fullName|phone|email))*$/.test(value)
            || processDefectWrite && value === 'factoryCode' || manualProcessDefectUpdate && value.length <= 512 && /^[a-zA-Z]+(,[a-zA-Z]+)*$/.test(value))));
        })
        .map(([key, value]) => [key, value]).concat(trialFields),
    ) as Prisma.InputJsonObject;
  }

  private isSafeConfigurationValue(key: string, value: Prisma.InputJsonValue | null | undefined): boolean {
    if (key === 'protocol') return ['OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES', 'GEMINI_GENERATE_CONTENT'].includes(String(value));
    if (key === 'publishedVersion') return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
    if (key === 'enabled' || key === 'reprocessed') return typeof value === 'boolean';
    if (key === 'receiptCount') return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100000;
    if (key === 'rowCount' || key === 'cancelledJobCount') return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    if (key === 'rowIndex') return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
    if (key === 'ruleVersion') return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
    if (key === 'target') return ['SUPPLIER', 'CUSTOMER', 'MATERIAL', 'COMPONENT', 'OPERATION'].includes(String(value));
    if (key === 'action') return ['PAUSE', 'RESUME', 'CANCEL', 'RETRY'].includes(String(value));
    if (key === 'result') return ['INSERTED', 'UPDATED', 'UNCHANGED', 'FILTERED', 'EXISTING_SKIPPED', 'AWAITING_CONFIRMATION', 'VALIDATION_FAILED', 'PROCESSING_FAILED', 'SKIPPED', 'CANCELLED'].includes(String(value));
    if (key === 'returnReceipt') return typeof value === 'boolean';
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
