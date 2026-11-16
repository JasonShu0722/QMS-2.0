import { Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type ProcessDefect } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { ComponentProjectService } from '../platform-configuration/component-project.service.js';
import type { ComponentProjectMappingDto, ComponentProjectRecordDto } from '../platform-configuration/component-project.dto.js';
import { processDefectRequiredIssues } from './process-defect-registration.policy.js';

export type ProcessProjectSnapshot = {
  componentCode: string; associatedAt: string;
  mapping: Pick<ComponentProjectMappingDto, 'id' | 'version' | 'status' | 'componentCode' | 'componentName' | 'projectRecordId' | 'productCategory' | 'productSubcategory'>;
  project: Pick<ComponentProjectRecordDto, 'id' | 'version' | 'status' | 'code' | 'name' | 'stage'>;
};
type RegistrationFacts = { productCode: string | null; operationName: string | null; occurredAt: Date | null; traceCode: string | null; description: string };
export type ProcessOperationSector = { id: string; organizationId: string; operationName: string; sectorName: string; active: boolean; version: number };

export function processProjectSnapshot(value: unknown): ProcessProjectSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const saved = value as Partial<ProcessProjectSnapshot>;
  if (typeof saved.componentCode !== 'string' || typeof saved.associatedAt !== 'string' || !saved.mapping || !saved.project
    || typeof saved.mapping.id !== 'string' || !Number.isSafeInteger(saved.mapping.version)
    || typeof saved.project.id !== 'string' || typeof saved.project.code !== 'string' || typeof saved.project.name !== 'string'
    || !Number.isSafeInteger(saved.project.version) || !['NEW_PRODUCT', 'MASS_PRODUCTION'].includes(saved.project.stage)) return null;
  return saved as ProcessProjectSnapshot;
}

export type ProcessDefectDerivedFacts = {
  projectSnapshot: Prisma.InputJsonObject | typeof Prisma.DbNull; projectCode: string | null;
  productSubcategory: string | null; subcategorySnapshot: Prisma.InputJsonValue | typeof Prisma.DbNull;
  operationSector: string | null; sectorSnapshot: Prisma.InputJsonValue | typeof Prisma.DbNull;
  registrationIssues: string[]; pendingCompletion: boolean; pendingConfiguration: boolean;
};

@Injectable()
export class ProcessDefectCompletionService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService,
    @Optional() private readonly projects?: ComponentProjectService) {}

  async derive(tx: AdminTransaction, organizationId: string, facts: RegistrationFacts, previous?: ProcessDefect, correctedFields: readonly string[] = []): Promise<ProcessDefectDerivedFacts> {
    const productChanged = previous !== undefined && previous.productCode !== facts.productCode;
    const operationChanged = previous !== undefined && previous.operationName !== facts.operationName;
    let projectSnapshot = productChanged ? null : processProjectSnapshot(previous?.projectSnapshot ?? null);
    let productSubcategory = productChanged ? null : previous?.productSubcategory ?? null;
    let subcategorySnapshot = productChanged ? null : previous?.subcategorySnapshot ?? null;
    let operationSector = operationChanged ? null : previous?.operationSector ?? null;
    let sectorSnapshot = operationChanged ? null : previous?.sectorSnapshot ?? null;
    const now = new Date().toISOString();
    if (facts.productCode && (!projectSnapshot || !productSubcategory) && this.projects) {
      const resolved = await this.projects.resolveForDomain(tx, organizationId, facts.productCode);
      const mapping = resolved.mapping;
      if (mapping?.status === 'ACTIVE') {
        if (!projectSnapshot && resolved.project?.status === 'ACTIVE') {
          const project = resolved.project;
          projectSnapshot = { componentCode: facts.productCode, associatedAt: now,
            mapping: { id: mapping.id, version: mapping.version, status: mapping.status, componentCode: mapping.componentCode,
              componentName: mapping.componentName, projectRecordId: mapping.projectRecordId, productCategory: mapping.productCategory, productSubcategory: mapping.productSubcategory },
            project: { id: project.id, version: project.version, status: project.status, code: project.code, name: project.name, stage: project.stage } };
        }
        if (!productSubcategory && mapping.productSubcategory) {
          productSubcategory = mapping.productSubcategory;
          subcategorySnapshot = { mappingId: mapping.id, mappingVersion: mapping.version, associatedAt: now, componentCode: facts.productCode };
        }
      }
    }
    if (!operationSector && facts.operationName) {
      const [rule] = await tx.$queryRaw<ProcessOperationSector[]>`SELECT id, organization_id AS "organizationId", operation_name AS "operationName",
        sector_name AS "sectorName", active, version FROM process_operation_sectors
        WHERE organization_id = ${organizationId}::uuid AND operation_name = ${facts.operationName.trim()} AND active FOR SHARE`;
      if (rule) {
        operationSector = rule.sectorName;
        sectorSnapshot = { ruleId: rule.id, ruleVersion: rule.version, operationName: rule.operationName, associatedAt: now };
      }
    }
    const priorIssues = previous?.registrationIssues.filter(issue => {
      if (!issue.includes(':')) return false;
      const field = issue.split(':')[0]!;
      return !correctedFields.includes(field) && (!(field in facts) || (facts as Record<string, unknown>)[field] === (previous as unknown as Record<string, unknown>)[field]);
    }) ?? [];
    const registrationIssues = [...new Set([...processDefectRequiredIssues(facts), ...priorIssues])];
    return {
      projectSnapshot: projectSnapshot ? projectSnapshot as unknown as Prisma.InputJsonObject : Prisma.DbNull,
      projectCode: projectSnapshot?.project.code ?? null,
      productSubcategory, subcategorySnapshot: subcategorySnapshot ?? Prisma.DbNull,
      operationSector, sectorSnapshot: sectorSnapshot ?? Prisma.DbNull,
      registrationIssues, pendingCompletion: registrationIssues.length > 0,
      pendingConfiguration: !projectSnapshot || !productSubcategory || !operationSector,
    };
  }

  static async history(tx: AdminTransaction, record: ProcessDefect, previous: ProcessDefect | null, actorUserId: string | null, action: string) {
    const facts = (value: ProcessDefect) => JSON.stringify({ occurredAt: value.occurredAt, productCode: value.productCode, traceCode: value.traceCode,
      description: value.description, workOrderCode: value.workOrderCode, lineCode: value.lineCode, operationCode: value.operationCode,
      sourceObservedAt: value.sourceObservedAt, lineName: value.lineName, operationName: value.operationName, defectQuantity: value.defectQuantity,
      externalRecordKey: value.externalRecordKey, projectSnapshot: value.projectSnapshot, productSubcategory: value.productSubcategory,
      operationSector: value.operationSector, sectorSnapshot: value.sectorSnapshot, subcategorySnapshot: value.subcategorySnapshot,
      registrationIssues: value.registrationIssues, pendingCompletion: value.pendingCompletion, pendingConfiguration: value.pendingConfiguration });
    await tx.$executeRaw`INSERT INTO process_defect_registration_history (id, organization_id, defect_id, defect_version, actor_user_id, action, before_facts, after_facts)
      VALUES (${randomUUID()}::uuid, ${record.organizationId}::uuid, ${record.id}::uuid, ${record.version}, ${actorUserId}::uuid, ${action},
        ${previous ? facts(previous) : null}::jsonb, ${facts(record)}::jsonb)`;
  }

  async processDue(limit = 20) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('PROCESS_DEFECT_COMPLETION_LIMIT_INVALID');
    const candidates = await this.prisma.$queryRaw<{ id: string; organizationId: string; version: number }[]>`SELECT d.id, d.organization_id AS "organizationId", d.version
      FROM process_defects d JOIN organizations o ON o.id = d.organization_id
      WHERE d.registration_version = 1 AND d.pending_configuration AND d.archived_at IS NULL
        AND (d.completion_next_attempt_at IS NULL OR d.completion_next_attempt_at <= CURRENT_TIMESTAMP)
        AND o.type = 'INTERNAL' AND o.status = 'ACTIVE' AND o.deleted_at IS NULL AND NOT o.configuration_required
      ORDER BY d.completion_next_attempt_at NULLS FIRST, d.id LIMIT ${limit}`;
    let completed = 0, failed = 0, unrecorded = 0;
    for (const candidate of candidates) {
      try { await this.prisma.$transaction(async tx => {
        const [organization] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM organizations WHERE id = ${candidate.organizationId}::uuid
          AND type = 'INTERNAL' AND status = 'ACTIVE' AND deleted_at IS NULL AND NOT configuration_required FOR SHARE`;
        if (!organization) return;
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM process_defects WHERE id = ${candidate.id}::uuid
          AND version = ${candidate.version} AND archived_at IS NULL AND pending_configuration FOR UPDATE SKIP LOCKED`;
        if (!locked.length) return;
        const current = await tx.processDefect.findUniqueOrThrow({ where: { id: candidate.id } });
        const derived = await this.derive(tx, current.organizationId, current, current);
        const changed = JSON.stringify(current.projectSnapshot) !== JSON.stringify(derived.projectSnapshot === Prisma.DbNull ? null : derived.projectSnapshot)
          || current.productSubcategory !== derived.productSubcategory || current.operationSector !== derived.operationSector;
        if (!changed) {
          await tx.processDefect.updateMany({ where: { id: current.id, version: current.version, archivedAt: null },
            data: { completionNextAttemptAt: new Date(Date.now() + 60000) } });
          return;
        }
        const updated = await tx.processDefect.updateMany({ where: { id: current.id, version: current.version, archivedAt: null },
          data: { ...derived, completionNextAttemptAt: derived.pendingConfiguration ? new Date(Date.now() + 60000) : null, completionAttempts: 0, version: { increment: 1 } } });
        if (updated.count !== 1) return;
        const record = await tx.processDefect.findUniqueOrThrow({ where: { id: current.id } });
        await ProcessDefectCompletionService.history(tx, record, current, null, 'AUTO_COMPLETED');
        await this.audit.record({ organizationId: current.organizationId, actorUserId: null, action: 'PROCESS_DEFECT_AUTO_COMPLETED',
          resourceType: 'ProcessDefect', resourceId: current.id, outcome: 'SUCCESS', traceId: randomUUID(), metadata: { resourceVersion: record.version } }, tx);
        completed++;
      }); } catch {
        failed++;
        try { await this.prisma.$transaction(async tx => {
          const [organization] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM organizations WHERE id = ${candidate.organizationId}::uuid
            AND type = 'INTERNAL' AND status = 'ACTIVE' AND deleted_at IS NULL AND NOT configuration_required FOR SHARE`;
          if (!organization) return;
          await tx.processDefect.updateMany({ where: { id: candidate.id, version: candidate.version, archivedAt: null, pendingConfiguration: true },
            data: { completionNextAttemptAt: new Date(Date.now() + 60000), completionAttempts: { increment: 1 } } });
        }); } catch { unrecorded++; }
      }
    }
    return { processed: candidates.length, completed, failed, unrecorded };
  }
}
