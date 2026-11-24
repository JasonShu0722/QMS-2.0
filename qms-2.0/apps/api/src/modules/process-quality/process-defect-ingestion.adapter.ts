import { HttpException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { ProcessDefect } from '../../generated/prisma/client.js';
import { aiDescriptionDisposition, validateAiDescription, type AiDescriptionField } from '../../common/ai-description.js';
import { assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { processDefectIssueField, type IntegrationExpected, type ProcessDefectIntegrationFields, type ProcessDefectIntegrationRecord } from '../../common/integration-master-data.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { ProcessDefectCompletionService } from './process-defect-completion.service.js';
import { normalizeProcessDefectFacts } from './process-defect-ledger.service.js';
import { processDefectRequiredIssues } from './process-defect-registration.policy.js';
import { ProcessLedgerWorkflowConfigurationService } from './process-ledger-workflow-configuration.service.js';

const sourceFields = ['occurredAt', 'factoryCode', 'productCode', 'workOrderCode', 'lineCode', 'lineName', 'operationCode', 'operationName', 'traceCode', 'description', 'externalRecordKey', 'sourceObservedAt'] as const;
const isFactoryIssue = (issue: string) => processDefectIssueField(issue) === 'factoryCode';
function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }

@Injectable()
export class ProcessDefectIngestionAdapter {
  constructor(private readonly audit: AuditLogService, private readonly completion: ProcessDefectCompletionService,
    private readonly workflowConfiguration: ProcessLedgerWorkflowConfigurationService) {}

  assertAiDescriptionRegistrationAccess(tx: AdminTransaction, actor: AdminActor) {
    return this.workflowConfiguration.assertCanMaintain(tx, actor, actor.scopeOrganizationId ?? actor.organizationId, 'REGISTRATION');
  }

  async results(tx: AdminTransaction, actor: AdminActor, targetIds: string[]) {
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
    if (!Array.isArray(targetIds) || targetIds.length > 1000 || targetIds.some(id => !isUUID(id))) fail('INTEGRATION_INPUT_INVALID', 400);
    return tx.processDefect.findMany({ where: { organizationId, id: { in: targetIds }, archivedAt: null },
      select: { id: true, pendingCompletion: true, pendingConfiguration: true, defectQuantity: true } });
  }

  private async scope(tx: AdminTransaction, actor: AdminActor, fields: ProcessDefectIntegrationFields) {
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:write');
    const [organization] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM organizations WHERE id = ${organizationId}::uuid AND type = 'INTERNAL'
      AND status = 'ACTIVE' AND deleted_at IS NULL AND NOT configuration_required FOR SHARE`;
    if (!organization) fail('ORGANIZATION_DISABLED', 403);
    if (!fields || !isUUID(fields.receiptId) || !Number.isSafeInteger(fields.rowIndex) || fields.rowIndex < 0
      || Object.keys(fields).some(field => ![...sourceFields, 'receiptId', 'rowIndex', 'issues'].includes(field as never))) fail('INTEGRATION_INPUT_INVALID', 400);
    return organizationId;
  }

  private async find(tx: AdminTransaction, organizationId: string, fields: ProcessDefectIntegrationFields, linkedTargetId?: string) {
    if (linkedTargetId !== undefined && !isUUID(linkedTargetId)) fail('INTEGRATION_INPUT_INVALID', 400);
    const rows = await tx.processDefect.findMany({ where: { organizationId, OR: [
      { sourceReceiptId: fields.receiptId, sourceRowIndex: fields.rowIndex },
      ...(fields.externalRecordKey ? [{ externalSourceSystem: 'IMS', externalRecordKey: fields.externalRecordKey }] : []),
      ...(linkedTargetId ? [{ id: linkedTargetId }] : []),
    ] }, take: 2 });
    if (rows.length > 1) fail('PROCESS_DEFECT_EXTERNAL_IDENTITY_CONFLICT', 409);
    if (linkedTargetId && rows[0]?.id !== linkedTargetId) fail('CONCURRENCY_CONFLICT', 409);
    return rows[0] ?? null;
  }

  private record(row: ProcessDefect, fields: ProcessDefectIntegrationFields): ProcessDefectIntegrationRecord {
    const values: ProcessDefectIntegrationFields = { receiptId: fields.receiptId, rowIndex: fields.rowIndex, issues: row.registrationIssues };
    for (const field of sourceFields) {
      if (field === 'factoryCode') {
        values.factoryCode = row.factoryCode;
        continue;
      }
      const value = field === 'description' && !row.manualFields.includes('description') ? row.descriptionDirect ?? row.description : row[field];
      if (value !== null && value !== '') values[field] = value instanceof Date ? value.toISOString() : value;
    }
    return { id: row.id, version: row.version, values, deleted: !!row.archivedAt, protectedFields: this.protectedFields(row),
      pendingCompletion: row.pendingCompletion, pendingConfiguration: row.pendingConfiguration };
  }

  private protectedFields(row: ProcessDefect) {
    return row.sourceKind === 'MANUAL' && row.registrationVersion === null
      ? [...new Set([...row.manualFields, ...sourceFields.filter(field => row[field] !== null && row[field] !== '')])]
      : row.manualFields;
  }

  async inspect(tx: AdminTransaction, actor: AdminActor, fields: ProcessDefectIntegrationFields, linkedTargetId?: string): Promise<ProcessDefectIntegrationRecord | null> {
    const organizationId = await this.scope(tx, actor, fields);
    const row = await this.find(tx, organizationId, fields, linkedTargetId);
    return row ? this.record(row, fields) : null;
  }

  async write(tx: AdminTransaction, actor: AdminActor, fields: ProcessDefectIntegrationFields, expected: IntegrationExpected, traceId: string, confirmed = false): Promise<ProcessDefectIntegrationRecord> {
    const organizationId = await this.scope(tx, actor, fields);
    const identity = `${organizationId}:IMS:${fields.externalRecordKey ?? `${fields.receiptId}:${fields.rowIndex}`}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))::text`;
    const current = await this.find(tx, organizationId, fields, expected?.id);
    if (current) await tx.$queryRaw`SELECT id FROM process_defects WHERE id=${current.id}::uuid FOR UPDATE`;
    const locked = current ? await tx.processDefect.findUniqueOrThrow({ where: { id: current.id } }) : null;
    if (locked?.archivedAt) fail('PROCESS_DEFECT_ARCHIVED', 409);
    if (expected === null ? !!current : !current || current.id !== expected.id || current.version !== expected.version) fail('CONCURRENCY_CONFLICT', 409);
    if (current?.archivedAt) fail('PROCESS_DEFECT_ARCHIVED', 409);
    const supplied = Object.fromEntries(sourceFields.filter(field => fields[field] !== undefined && fields[field] !== '').map(field => [field, fields[field]]));
    const changedFields = Object.keys(supplied).filter(field => {
      const old = field === 'description' && current && !current.manualFields.includes('description') ? current.descriptionDirect ?? current.description : current?.[field as typeof sourceFields[number]];
      return (old instanceof Date ? old.toISOString() : field === 'factoryCode' ? old ?? null : old) !== supplied[field];
    });
    const factoryEvaluated = fields.factoryCode !== undefined;
    const incomingFactoryIssues = [...new Set(fields.issues?.filter(isFactoryIssue))];
    const priorFactoryIssues = current?.registrationIssues.filter(isFactoryIssue) ?? [];
    const factoryIssuesChanged = factoryEvaluated && (incomingFactoryIssues.length !== priorFactoryIssues.length || priorFactoryIssues.some(issue => !incomingFactoryIssues.includes(issue)));
    if (current && !confirmed && this.protectedFields(current).some(field => changedFields.includes(field) || field === 'factoryCode' && factoryIssuesChanged)) fail('PROCESS_DEFECT_MANUAL_CONFIRMATION_REQUIRED', 409);
    if (current?.externalRecordKey && supplied.externalRecordKey && current.externalRecordKey !== supplied.externalRecordKey) fail('PROCESS_DEFECT_EXTERNAL_IDENTITY_CONFLICT', 409);
    const input = { ...current, ...supplied, externalSourceSystem: current?.externalSourceSystem ?? 'IMS',
      ...(current && !changedFields.includes('description') ? { description: current.description } : {}),
      occurredAt: typeof supplied.occurredAt === 'string' ? new Date(supplied.occurredAt) : current?.occurredAt ?? null,
      sourceObservedAt: typeof supplied.sourceObservedAt === 'string' ? new Date(supplied.sourceObservedAt) : current?.sourceObservedAt ?? null };
    const facts = normalizeProcessDefectFacts(input as Parameters<typeof normalizeProcessDefectFacts>[0], 'IMS');
    if (current) facts.defectQuantity = current.defectQuantity;
    const derived = !current || current.registrationVersion === 1 ? await this.completion.derive(tx, organizationId, facts, current ?? undefined, Object.keys(supplied)) : null;
    const baseIssues = derived?.registrationIssues ?? current?.registrationIssues ?? [];
    const registrationIssues = [...new Set([
      ...baseIssues.filter(issue => !factoryEvaluated || !isFactoryIssue(issue)),
      ...(derived ? fields.issues ?? [] : incomingFactoryIssues),
    ])];
    const issueUpdate = derived || factoryIssuesChanged ? { registrationIssues, pendingCompletion: registrationIssues.length > 0 } : null;
    const issuesChanged = current !== null && issueUpdate !== null && (current.registrationIssues.length !== issueUpdate.registrationIssues.length
      || current.registrationIssues.some(issue => !issueUpdate.registrationIssues.includes(issue)));
    if (current && !changedFields.length && !issuesChanged) return this.record(current, fields);
    let record: ProcessDefect;
    if (current) {
      const changed = await tx.processDefect.updateMany({ where: { id: current.id, version: current.version, archivedAt: null }, data: {
        ...facts, ...derived, ...issueUpdate, updatedById: actor.id, version: { increment: 1 },
        ...(changedFields.includes('description') ? { descriptionDirect: facts.description, descriptionSource: 'DIRECT', descriptionInputVersion: { increment: 1 }, descriptionAiStatus: 'DISABLED', descriptionAi: null } : {}),
        ...(confirmed ? { manualFields: current.manualFields.filter(field => !changedFields.includes(field)) } : {}),
      } });
      if (changed.count !== 1) fail('CONCURRENCY_CONFLICT', 409);
      record = await tx.processDefect.findUniqueOrThrow({ where: { id: current.id } });
    } else {
      record = await tx.processDefect.create({ data: { ...facts, ...derived, ...issueUpdate, organizationId, createdById: actor.id, updatedById: actor.id,
        descriptionDirect: facts.description, descriptionSource: 'DIRECT',
        registrationVersion: 1, sourceKind: 'IMS', sourceReceiptId: fields.receiptId, sourceRowIndex: fields.rowIndex, ingestionStatus: 'PENDING_VERIFICATION' } });
    }
    await ProcessDefectCompletionService.history(tx, record, current, actor.id, current ? 'IMS_UPDATED' : 'IMS_CREATED');
    await this.audit.record({ organizationId, actorUserId: actor.id, action: current ? 'PROCESS_DEFECT_INGESTION_UPDATED' : 'PROCESS_DEFECT_INGESTION_CREATED',
      resourceType: 'ProcessDefect', resourceId: record.id, outcome: 'SUCCESS', traceId,
      metadata: { resourceVersion: record.version, receiptId: fields.receiptId, rowIndex: fields.rowIndex,
        changedFields: changedFields.includes('factoryCode') || factoryIssuesChanged ? 'factoryCode' : undefined } }, tx);
    return this.record(record, fields);
  }

  async aiDescriptionState(tx: AdminTransaction, actor: AdminActor, id: string, lock = false) {
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:write');
    const [organization] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM organizations WHERE id=${organizationId}::uuid AND type='INTERNAL' AND status='ACTIVE' AND deleted_at IS NULL AND NOT configuration_required FOR SHARE`;
    if (!organization) fail('ORGANIZATION_DISABLED', 403);
    if (lock) await tx.$queryRaw`SELECT id FROM process_defects WHERE organization_id=${organizationId}::uuid AND id=${id}::uuid FOR UPDATE`;
    const row = await tx.processDefect.findFirst({ where: { organizationId, id } });
    if (!row) fail('PROCESS_DEFECT_NOT_FOUND', 404);
    return row;
  }

  async prepareAiDescription(tx: AdminTransaction, actor: AdminActor, id: string, taskId: string, fields: AiDescriptionField[], direct: string, preserveText = false) {
    const row = await this.aiDescriptionState(tx, actor, id, true);
    if (row.archivedAt) fail('PROCESS_DEFECT_ARCHIVED', 409);
    const revision = row.descriptionInputVersion + 1;
    const protectedDescription = preserveText || row.manualFields.includes('description');
    const description = protectedDescription ? row.description : direct;
    const descriptionRequired = processDefectRequiredIssues({ occurredAt: row.occurredAt, productCode: row.productCode, traceCode: row.traceCode, description }).includes('DESCRIPTION_REQUIRED');
    const registrationIssues = protectedDescription ? row.registrationIssues : descriptionRequired
      ? [...new Set([...row.registrationIssues, 'DESCRIPTION_REQUIRED'])] : row.registrationIssues.filter(issue => issue !== 'DESCRIPTION_REQUIRED');
    const pendingCompletion = protectedDescription ? row.pendingCompletion : registrationIssues.length > 0;
    const factsChanged = description !== row.description || pendingCompletion !== row.pendingCompletion || JSON.stringify(registrationIssues) !== JSON.stringify(row.registrationIssues);
    const record = await tx.processDefect.update({ where: { id }, data: { descriptionInput: fields, ...(!preserveText ? { descriptionDirect: direct } : {}), descriptionInputVersion: revision,
      descriptionTaskId: taskId, descriptionAi: null, descriptionAiStatus: 'PENDING',
      ...(!protectedDescription ? { description, descriptionSource: 'DIRECT', registrationIssues, pendingCompletion } : {}),
      ...(factsChanged ? { version: { increment: 1 }, updatedById: actor.id } : {}) } });
    if (factsChanged) {
      await ProcessDefectCompletionService.history(tx, record, row, actor.id, 'AI_DESCRIPTION_FALLBACK');
      await this.audit.record({ organizationId: row.organizationId, actorUserId: actor.id, action: 'PROCESS_DEFECT_AI_DESCRIPTION_FALLBACK',
        resourceType: 'ProcessDefect', resourceId: id, outcome: 'SUCCESS', traceId: taskId, metadata: { resourceVersion: record.version } }, tx);
    }
    return { revision, previousVersion: row.version, version: record.version };
  }

  async markAiDescription(tx: AdminTransaction, actor: AdminActor, id: string, revision: number, status: 'PENDING' | 'FAILED' | 'RETRY' | 'STALE') {
    const row = await this.aiDescriptionState(tx, actor, id);
    await tx.processDefect.updateMany({ where: { id, organizationId: row.organizationId, descriptionInputVersion: revision, archivedAt: null }, data: { descriptionAiStatus: status } });
  }

  async expireAiDescription(tx: AdminTransaction, organizationId: string, id: string, taskId: string, revision: number) {
    await tx.processDefect.updateMany({ where: { id, organizationId, descriptionTaskId: taskId, descriptionInputVersion: revision, archivedAt: null },
      data: { descriptionAiStatus: 'FAILED' } });
  }

  async applyAiDescription(tx: AdminTransaction, actor: AdminActor, id: string, revision: number, direct: string, text: string, traceId: string, mode: 'automatic' | 'adopt' | 'suggestion' = 'automatic') {
    text = validateAiDescription(text);
    const scoped = await this.aiDescriptionState(tx, actor, id);
    await tx.$queryRaw`SELECT id FROM process_defects WHERE organization_id=${scoped.organizationId}::uuid AND id=${id}::uuid FOR UPDATE`;
    const row = await tx.processDefect.findUniqueOrThrow({ where: { id } });
    const decision = aiDescriptionDisposition({ expectedRevision: revision, currentRevision: row.descriptionInputVersion,
      expectedDescription: direct, currentDescription: row.description, manualFields: row.manualFields, archived: !!row.archivedAt });
    if (decision === 'STALE') return decision;
    const adopt = mode === 'adopt';
    if (mode === 'suggestion' || (decision === 'SUGGESTED' && !adopt)) {
      await tx.processDefect.update({ where: { id }, data: { descriptionAi: text, descriptionAiStatus: 'SUGGESTED' } });
      return 'SUGGESTED' as const;
    }
    const registrationIssues = row.registrationIssues.filter(issue => issue !== 'DESCRIPTION_REQUIRED' && !issue.startsWith('description:'));
    const record = await tx.processDefect.update({ where: { id }, data: { description: text, descriptionAi: text, descriptionAiStatus: 'APPLIED',
      descriptionSource: 'AI', registrationIssues, pendingCompletion: registrationIssues.length > 0, version: { increment: 1 }, updatedById: actor.id,
      ...(adopt ? { manualFields: [...new Set([...row.manualFields, 'description'])] } : {}) } });
    await ProcessDefectCompletionService.history(tx, record, row, actor.id, adopt ? 'AI_DESCRIPTION_ADOPTED' : 'AI_DESCRIPTION_APPLIED');
    await this.audit.record({ organizationId: row.organizationId, actorUserId: actor.id, action: adopt ? 'PROCESS_DEFECT_AI_DESCRIPTION_ADOPTED' : 'PROCESS_DEFECT_AI_DESCRIPTION_APPLIED',
      resourceType: 'ProcessDefect', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: record.version } }, tx);
    return 'APPLIED' as const;
  }
}
