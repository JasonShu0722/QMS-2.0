import { HttpException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { mfaPolicy } from '../../common/security/session-security.js';
import { hasPlatformAdministrator } from '../../common/security/platform-administrator.js';
import type { DomainSourceRecord, DomainSourceReference } from '../problem-index/domain-source-issue.service.js';
import { ProcessDefectLedgerService } from '../process-quality/process-defect-ledger.service.js';
import { ComponentProjectService } from '../platform-configuration/component-project.service.js';

export const NEW_PRODUCT_SELECTION_SOURCE = Object.freeze({
  sourceDomain: 'new-product-quality',
  sourceType: 'new-product-defect-selection',
  problemType: 'NEW_PRODUCT_ISSUE',
} as const);

export interface NewProductSelectionInclusion {
  projectId: string;
  projectCode: string;
  componentCode: string;
  mappingId: string;
  mappingVersion: number;
  projectRecordId: string;
  projectRecordVersion: number;
  observedProjectStage: 'NEW_PRODUCT';
  observedAt: string;
  occurredAt: string | null;
  // The current public mapping port cannot certify the stage at occurredAt.
  temporalEvidence: 'MANUAL_CONFIRMATION' | 'UNVERIFIED';
  confirmedById: string | null;
  confirmationReason: string | null;
  warnings: string[];
}

export interface NewProductEightDSourcePort {
  sourceReference(actor: AdminActor, selectionId: string): Promise<DomainSourceReference>;
  lockAndResolve(tx: AdminTransaction, reference: DomainSourceReference, actor: AdminActor): Promise<DomainSourceRecord | null>;
}

type Selection = {
  id: string; organization_id: string; project_id: string; defect_id: string; source_version: number;
  source_snapshot: Prisma.InputJsonObject; selection_reason: string | null; selected_by_id: string; selected_at: Date;
};

function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
function uuid(id: string): string { if (!isUUID(id)) fail('NEW_PRODUCT_INPUT_INVALID', 400); return id; }

@Injectable()
export class NewProductEightDSourceService implements NewProductEightDSourcePort {
  constructor(private readonly prisma: PrismaService, private readonly ledger: ProcessDefectLedgerService,
    private readonly mappings: ComponentProjectService) {}

  static async assertRead(tx: AdminTransaction, actor: AdminActor, organizationId = actor.scopeOrganizationId ?? actor.organizationId): Promise<void> {
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    // Recheck security facts without taking user/session locks after the caller's domain locks.
    const session = await tx.session.findFirst({ where: { id: actor.sessionId, userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() },
      user: { status: 'ACTIVE', mustChangePassword: false, organization: { status: 'ACTIVE' } } },
    select: { securityVersion: true, mfaVerifiedAt: true, user: { select: { securityVersion: true } } } });
    if (!actor.sessionId || !session || session.securityVersion !== session.user.securityVersion) fail('AUTH_SESSION_REQUIRED', 401);
    if ((await mfaPolicy(tx, actor.id)).required && !session.mfaVerifiedAt) fail('AUTH_MFA_REQUIRED', 401);
    if (organizationId !== actor.organizationId && !await hasPlatformAdministrator(tx, actor.id)) fail('ORGANIZATION_SCOPE_DENIED', 403);
    await assertAdminAccess(tx, actor, organizationId, ['new-product-quality:projects:read', 'process-quality:defects:read']);
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { type: true } });
    if (organization?.type !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
  }

  async processReference(actor: AdminActor, defectId: string): Promise<DomainSourceReference> {
    uuid(defectId);
    await this.prisma.$transaction(tx => NewProductEightDSourceService.assertRead(tx, actor));
    return this.ledger.sourceReference(actor, defectId);
  }

  async selectionSnapshot(tx: AdminTransaction, actor: AdminActor, project: { id: string; code: string }, reference: DomainSourceReference,
    reason: string | null): Promise<Prisma.InputJsonObject> {
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    await NewProductEightDSourceService.assertRead(tx, actor, organizationId);
    const source = await this.ledger.lockAndResolve(tx, reference);
    if (!source || source.organizationId !== organizationId || source.archivedAt) fail('PROCESS_DEFECT_NOT_FOUND', 404);
    if (source.sourceVersion !== reference.sourceVersion) fail('CONCURRENCY_CONFLICT', 409);
    const facts = source.sourceSnapshot;
    if (typeof facts.productCode !== 'string' || !facts.productCode.trim()) fail('NEW_PRODUCT_DEFECT_MAPPING_REQUIRED', 409);
    const resolution = await this.mappings.resolveForDomain(tx, organizationId, facts.productCode);
    if (resolution.outcome !== 'matched' || !resolution.mapping || !resolution.project) fail('NEW_PRODUCT_DEFECT_MAPPING_REQUIRED', 409);
    if (resolution.project.code !== project.code) fail('NEW_PRODUCT_DEFECT_PROJECT_MISMATCH', 409);
    if (resolution.project.stage !== 'NEW_PRODUCT') fail('NEW_PRODUCT_DEFECT_STAGE_INELIGIBLE', 409);
    const occurredAt = typeof facts.occurredAt === 'string' ? facts.occurredAt : null;
    const inclusion: NewProductSelectionInclusion = {
      projectId: project.id, projectCode: project.code, componentCode: facts.productCode,
      mappingId: resolution.mapping.id, mappingVersion: resolution.mapping.version,
      projectRecordId: resolution.project.id, projectRecordVersion: resolution.project.version,
      observedProjectStage: 'NEW_PRODUCT', observedAt: new Date().toISOString(), occurredAt,
      temporalEvidence: reason ? 'MANUAL_CONFIRMATION' : 'UNVERIFIED', confirmedById: reason ? actor.id : null, confirmationReason: reason,
      warnings: [...(occurredAt === null ? ['OCCURRED_AT_UNKNOWN'] : []), 'HISTORICAL_MAPPING_UNAVAILABLE'],
    };
    return { ...facts, inclusion: JSON.parse(JSON.stringify(inclusion)) as Prisma.InputJsonObject };
  }

  async sourceReference(actor: AdminActor, selectionId: string): Promise<DomainSourceReference> {
    uuid(selectionId);
    return this.prisma.$transaction(async tx => {
      await NewProductEightDSourceService.assertRead(tx, actor);
      const selection = await this.selection(tx, actor, selectionId, false);
      if (!selection) fail('NEW_PRODUCT_SELECTION_NOT_FOUND', 404);
      return this.reference(selection);
    }, { isolationLevel: 'RepeatableRead' });
  }

  async prepareSourceLinks(tx: AdminTransaction, references: DomainSourceReference[], actor: AdminActor): Promise<() => Promise<void>> {
    await NewProductEightDSourceService.assertRead(tx, actor);
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    const ids = [...new Set(references.map(reference => uuid(reference.sourceId)))];
    if (!ids.length) return async () => {};
    // Resolve exact immutable selections in DB, then take all project write locks before any source lock.
    const projects = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT project.id FROM new_product_projects project
      WHERE project.organization_id = ${organizationId}::uuid AND project.id IN (
        SELECT project_id FROM new_product_defect_selections WHERE organization_id = ${organizationId}::uuid
          AND id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})) ORDER BY project.id FOR UPDATE OF project`);
    return async () => {
      for (const project of projects) {
        const changed = await tx.$executeRaw`UPDATE new_product_projects SET version = version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${project.id}::uuid AND organization_id = ${organizationId}::uuid AND status = 'ACTIVE'`;
        if (changed !== 1) fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      }
    };
  }

  async lockAndResolve(tx: AdminTransaction, reference: DomainSourceReference, actor?: AdminActor): Promise<DomainSourceRecord | null> {
    if (!actor) fail('AUTH_SESSION_REQUIRED', 401);
    await NewProductEightDSourceService.assertRead(tx, actor);
    if (reference.sourceDomain !== NEW_PRODUCT_SELECTION_SOURCE.sourceDomain || reference.sourceType !== NEW_PRODUCT_SELECTION_SOURCE.sourceType) return null;
    uuid(reference.sourceId);
    const selection = await this.selection(tx, actor, reference.sourceId, true);
    if (!selection) return null;
    const source = await this.ledger.lockAndResolve(tx, {
      sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: selection.defect_id,
      sourceVersion: selection.source_version, sourceSnapshot: selection.source_snapshot, createdBy: selection.selected_by_id,
    });
    if (!source || source.organizationId !== selection.organization_id) return null;
    // Selection facts are immutable; later process edits or stage changes do not rewrite an in-flight source.
    const selected = this.reference(selection);
    return { organizationId: selection.organization_id, createdBy: selected.createdBy, sourceVersion: selected.sourceVersion,
      sourceSnapshot: selected.sourceSnapshot, archivedAt: source.archivedAt ?? null };
  }

  private async selection(tx: AdminTransaction, actor: AdminActor, id: string, lock: boolean): Promise<Selection | undefined> {
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    const [selection] = await tx.$queryRaw<Selection[]>`SELECT * FROM new_product_defect_selections
      WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
    return selection;
  }

  private reference(selection: Selection): DomainSourceReference {
    return { sourceDomain: NEW_PRODUCT_SELECTION_SOURCE.sourceDomain, sourceType: NEW_PRODUCT_SELECTION_SOURCE.sourceType,
      sourceId: selection.id, sourceVersion: selection.source_version, createdBy: selection.selected_by_id,
      sourceSnapshot: { ...selection.source_snapshot, selectionId: selection.id, projectId: selection.project_id,
        selectedById: selection.selected_by_id, selectedAt: selection.selected_at.toISOString(), selectionReason: selection.selection_reason } };
  }
}
