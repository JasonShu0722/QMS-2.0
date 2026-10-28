import { HttpException, Injectable } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication, isSecurityConcurrencyConflict } from '../../common/security/session-security.js';
import type { SupplierCopyFact, SupplierCopyMaterial, SupplierCopySource } from '../../common/eight-d/supplier-copy.types.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { ProcessDefectLedgerService } from '../process-quality/process-defect-ledger.service.js';
import { CustomerComplaintLedgerService } from '../customer-quality/customer-complaint-ledger.service.js';
import { NewProductEightDSourceService } from '../new-product-quality/new-product-eight-d-source.service.js';
import { SupplierQualityService } from '../supplier-quality/supplier-quality.service.js';
import { canonical } from '../workflow/workflow-runtime-policy.js';
import { SupplierCopyDraftInputDto, SupplierCopyPreviewInputDto, type SupplierCopyDraftReceiptDto, type SupplierCopyFactDto, type SupplierCopyPreviewDto } from './supplier-eight-d-source.dto.js';

type Preview = { id: string; supplier_profile_id: string; sources: SupplierCopySource[]; projection_digest: string; profile_digest: string; expires_at: Date };
const permission = 'supplier-quality:issues:copy';
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }

@Injectable()
export class SupplierEightDSourceService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService,
    private readonly process: ProcessDefectLedgerService, private readonly customer: CustomerComplaintLedgerService,
    private readonly project: NewProductEightDSourceService, private readonly suppliers: SupplierQualityService) {}

  private scope(actor: AdminActor, requested?: string) {
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    if (requested && requested !== organizationId) fail('ORGANIZATION_SCOPE_DENIED', 403);
    return organizationId;
  }

  private async input<T extends object>(type: ClassConstructor<T>, input: T): Promise<T> {
    const dto = plainToInstance(type, input);
    if ((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length) fail('SUPPLIER_INPUT_INVALID', 400);
    return dto;
  }

  private async profile(tx: AdminTransaction, actor: AdminActor, profileId: string) {
    return this.suppliers.performanceProfile(tx, this.scope(actor), profileId);
  }

  private materialMatches(material: SupplierCopyMaterial, profile: { id: string; supplierOrganizationId: string | null }): boolean | null {
    // A business profile is the stronger identity; never compare its UUID with an enterprise UUID.
    if (material.supplierProfileId) return material.supplierProfileId === profile.id
      && (!material.supplierOrganizationId || material.supplierOrganizationId === profile.supplierOrganizationId);
    if (material.supplierOrganizationId) return material.supplierOrganizationId === profile.supplierOrganizationId;
    return null;
  }

  private async facts(tx: AdminTransaction, actor: AdminActor, sources: SupplierCopySource[], profile: { id: string; supplierOrganizationId: string | null }): Promise<{ owned: SupplierCopyFact[]; preview: SupplierCopyFactDto[] }> {
    const owned = new Map<string, SupplierCopyFact>();
    const output = new Map<string, SupplierCopyFactDto>();
    // Match project/selection writers, then order physical process rows across direct and wrapped aliases.
    const wrappedDefectIds = await this.project.prepareSupplierCopyProjection(tx, actor, sources.filter(source => source.kind === 'NEW_PRODUCT_SELECTION'));
    await this.process.prepareSupplierCopyProjection(tx, actor, [...wrappedDefectIds,
      ...sources.filter(source => source.kind === 'PROCESS_LEDGER').map(source => source.sourceId)]);
    const ordered = [...sources].sort((a, b) => `${a.kind}:${a.sourceId}`.localeCompare(`${b.kind}:${b.sourceId}`));
    for (const source of ordered) {
      const port = source.kind === 'PROCESS_LEDGER' ? this.process : source.kind === 'CUSTOMER_LEDGER' ? this.customer : this.project;
      const projection = await port.supplierCopyProjection(tx, actor, source);
      if (projection.organizationId !== this.scope(actor)) fail('ORGANIZATION_SCOPE_DENIED', 403);
      for (const fact of projection.facts) {
        const previous = owned.get(fact.factKey);
        if (previous && digest(previous) !== digest(fact)) fail('CONCURRENCY_CONFLICT', 409);
        owned.set(fact.factKey, fact);
        const chosen = source.materialItemId ? fact.materials.filter(item => item.id === source.materialItemId) : fact.materials;
        if (source.materialItemId && !chosen.length) fail('CONCURRENCY_CONFLICT', 409);
        const materials = chosen.flatMap(item => {
          const matches = this.materialMatches(item, profile);
          if (matches === false) {
            if (source.materialItemId) fail('CONCURRENCY_CONFLICT', 409);
            return [];
          }
          return [{ id: item.id, materialCode: matches ? item.materialCode : null, materialName: matches ? item.materialName : null, materialBatch: matches ? item.materialBatch : null }];
        });
        const existing = output.get(fact.factKey);
        const merged = [...new Map([...(existing?.materials ?? []), ...materials].map(item => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id));
        output.set(fact.factKey, { factKey: fact.factKey, defectDescription: fact.defectDescription, defectQuantity: fact.defectQuantity, materials: merged });
      }
    }
    return { owned: [...owned.values()].sort((a, b) => a.factKey.localeCompare(b.factKey)), preview: [...output.values()].sort((a, b) => a.factKey.localeCompare(b.factKey)) };
  }

  async preview(actor: AdminActor, input: SupplierCopyPreviewInputDto, traceId: string): Promise<SupplierCopyPreviewDto> {
    const dto = await this.input(SupplierCopyPreviewInputDto, input);
    const organizationId = this.scope(actor, dto.organizationId);
    return this.prisma.$transaction(async tx => {
      await assertActiveAuthentication(tx, actor);
      await assertAdminAccess(tx, actor, organizationId, permission);
      const profile = await this.profile(tx, actor, dto.supplierProfileId);
      const facts = await this.facts(tx, actor, dto.sources, profile);
      const token = randomUUID(); const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await tx.$executeRaw`INSERT INTO supplier_copy_previews(id, organization_id, actor_user_id, actor_session_id, supplier_profile_id, sources, projection_digest, profile_digest, expires_at)
        VALUES (${token}::uuid, ${organizationId}::uuid, ${actor.id}::uuid, ${actor.sessionId}::uuid, ${profile.id}::uuid,
          ${JSON.stringify(dto.sources)}::jsonb, ${digest(facts.owned)}, ${digest(profile)}, ${expiresAt})`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'SUPPLIER_SOURCE_COPY_PREVIEWED', resourceType: 'SupplierCopyPreview', resourceId: token, outcome: 'SUCCESS', traceId }, tx);
      return { token, expiresAt: expiresAt.toISOString(), facts: facts.preview };
    }, { isolationLevel: 'ReadCommitted' }).catch(error => {
      if (isSecurityConcurrencyConflict(error)) fail('CONCURRENCY_CONFLICT', 409);
      throw error;
    });
  }

  async createDraft(actor: AdminActor, input: SupplierCopyDraftInputDto, traceId: string, key?: string): Promise<SupplierCopyDraftReceiptDto> {
    const dto = await this.input(SupplierCopyDraftInputDto, input);
    const organizationId = this.scope(actor, dto.organizationId);
    this.scope(actor, dto.draft.organizationId);
    let checked: Preview;
    const authorize = async (tx: AdminTransaction) => {
      const [preview] = await tx.$queryRaw<Preview[]>`SELECT * FROM supplier_copy_previews WHERE id = ${dto.token}::uuid
        AND organization_id = ${organizationId}::uuid AND actor_user_id = ${actor.id}::uuid AND actor_session_id = ${actor.sessionId}::uuid FOR UPDATE`;
      if (!preview) fail('SUPPLIER_RECORD_NOT_FOUND', 404);
      if (preview.expires_at.getTime() <= Date.now()) fail('CONCURRENCY_CONFLICT', 409);
      if (dto.draft.profileId !== preview.supplier_profile_id) fail('CONCURRENCY_CONFLICT', 409);
      const profile = await this.profile(tx, actor, preview.supplier_profile_id);
      const facts = await this.facts(tx, actor, preview.sources, profile);
      if (digest(profile) !== preview.profile_digest || digest(facts.owned) !== preview.projection_digest) fail('CONCURRENCY_CONFLICT', 409);
      checked = preview;
    };
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_SOURCE_COPY_DRAFT_CREATED', payload: dto,
      permission: [permission, 'supplier-quality:problems:write'], isolationLevel: 'ReadCommitted' }, async tx => {
      const [used] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM supplier_copy_provenance WHERE preview_id = ${checked.id}::uuid`;
      if (used) fail('CONCURRENCY_CONFLICT', 409);
      const draft = await this.suppliers.createDraftInTransaction(tx, actor, dto.draft, traceId);
      // The neutral port now holds the profile SHARE lock; detect rebinding between our first read and that lock.
      if (digest(await this.profile(tx, actor, checked.supplier_profile_id)) !== checked.profile_digest) fail('CONCURRENCY_CONFLICT', 409);
      await tx.$executeRaw`INSERT INTO supplier_copy_provenance(id, organization_id, preview_id, supplier_problem_id, actor_user_id, sources, projection_digest)
        VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${checked.id}::uuid, ${draft.id}::uuid, ${actor.id}::uuid, ${JSON.stringify(checked.sources)}::jsonb, ${checked.projection_digest})`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'SUPPLIER_SOURCE_COPY_DRAFT_CREATED', resourceType: 'SupplierQualityProblem',
        resourceId: draft.id, outcome: 'SUCCESS', traceId }, tx);
      return { ...draft, stage: 'DRAFT' as const };
    }, authorize);
  }
}
