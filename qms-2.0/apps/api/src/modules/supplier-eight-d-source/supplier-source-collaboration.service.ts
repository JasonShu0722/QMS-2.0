import { BadRequestException, HttpException, Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { adminError, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { hasPlatformAdministrator } from '../../common/security/effective-role-grants.js';
import type { SupplierCollaborationProjection, SupplierCollaborationProjectionPort } from '../../common/eight-d/supplier-collaboration.types.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { CUSTOMER_EIGHT_D_RUNTIME, NEW_PRODUCT_EIGHT_D_RUNTIME, type InternalEightDRuntime } from '../../common/eight-d/internal-eight-d-runtime.js';
import { ProcessEightDService } from '../process-quality/process-eight-d.service.js';
import { ProcessDefectLedgerService } from '../process-quality/process-defect-ledger.service.js';
import { CustomerComplaintLedgerService } from '../customer-quality/customer-complaint-ledger.service.js';
import { NewProductEightDSourceService } from '../new-product-quality/new-product-eight-d-source.service.js';
import { SupplierSourceCollaborationReadModel, type CollaborationSourceReference } from '../problem-index/supplier-source-collaboration.read-model.js';
import type { SupplierSourceCollaborationPageDto, SupplierSourceCollaborationQueryDto, SupplierSourceCollaborationTaskDto } from './supplier-source-collaboration.dto.js';

@Injectable()
export class SupplierSourceCollaborationService {
  constructor(private readonly prisma: PrismaService, private readonly model: SupplierSourceCollaborationReadModel,
    private readonly process: ProcessDefectLedgerService, private readonly customer: CustomerComplaintLedgerService,
    private readonly newProduct: NewProductEightDSourceService, private readonly processCore: ProcessEightDService,
    @Inject(CUSTOMER_EIGHT_D_RUNTIME) private readonly customerRuntime: InternalEightDRuntime,
    @Inject(NEW_PRODUCT_EIGHT_D_RUNTIME) private readonly newProductRuntime: InternalEightDRuntime) {}

  async tasks(actor: AdminActor, query: SupplierSourceCollaborationQueryDto = {}): Promise<SupplierSourceCollaborationPageDto> {
    const organizationId = query.organizationId ?? actor.scopeOrganizationId ?? actor.organizationId;
    if (!isUUID(organizationId) || query.cursor !== undefined && !isUUID(query.cursor)
      || query.scanLimit !== undefined && (!Number.isInteger(query.scanLimit) || query.scanLimit < 1 || query.scanLimit > 100)) {
      throw new BadRequestException('Invalid collaboration query');
    }
    const scopedActor = { ...actor, scopeOrganizationId: organizationId };
    const authenticate = async (tx: AdminTransaction) => {
      if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
      await assertActiveAuthentication(tx, actor, 'SHARE');
      if (organizationId !== actor.organizationId && !await hasPlatformAdministrator(tx, actor.id)) adminError('ORGANIZATION_SCOPE_DENIED', 403);
      const organization = await tx.organization.findFirst({ where: { id: organizationId, status: 'ACTIVE', type: 'INTERNAL' }, select: { id: true } });
      if (!organization) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    };
    const project = async (tx: AdminTransaction, references: CollaborationSourceReference[]) => {
      const facts: SupplierCollaborationProjection[] = [];
      for (const reference of references) {
        const port: SupplierCollaborationProjectionPort | undefined = reference.sourceDomain === 'process-quality' && reference.sourceType === 'process-defect' ? this.process
          : reference.sourceDomain === 'customer-quality' && reference.sourceType === 'customer-complaint' ? this.customer
          : reference.sourceDomain === 'new-product-quality' && reference.sourceType === 'new-product-defect-selection' ? this.newProduct : undefined;
        if (!port) continue;
        try { facts.push(...await port.supplierCollaborationProjection(tx, scopedActor, reference.sourceId)); }
        catch (error) {
          if (!(error instanceof HttpException) || ![403, 404].includes(error.getStatus())) throw error;
        }
      }
      return facts;
    };
    const scan = await this.prisma.$transaction(async tx => {
      await authenticate(tx);
      const sourceId = Prisma.sql`collaboration_link.source_id`;
      const process = await this.process.supplierCollaborationPredicate(tx, scopedActor, sourceId);
      const customer = await this.customer.supplierCollaborationPredicate(tx, scopedActor, sourceId);
      const newProduct = await this.newProduct.supplierCollaborationPredicate(tx, scopedActor, sourceId);
      const eligibility = Prisma.sql`(
        (collaboration_link.source_domain = 'process-quality' AND collaboration_link.source_type = 'process-defect' AND ${process})
        OR (collaboration_link.source_domain = 'customer-quality' AND collaboration_link.source_type = 'customer-complaint' AND ${customer})
        OR (collaboration_link.source_domain = 'new-product-quality' AND collaboration_link.source_type = 'new-product-defect-selection' AND ${newProduct})
      )`;
      const page = await this.model.scan(tx, organizationId, eligibility, { after: query.cursor, scanLimit: query.scanLimit });
      const snapshots = [];
      for (const candidate of page.candidates) {
        const references = await this.model.currentReferences(tx, organizationId, candidate.problemId);
        const facts = await project(tx, references);
        // SQL admitted an eligible source; losing all facts now invalidates even the page metadata.
        if (!facts.length) adminError('CONCURRENCY_CONFLICT', 409);
        snapshots.push({ references, facts });
      }
      return { ...page, snapshots };
    }, { isolationLevel: 'ReadCommitted' });
    const items = new Map<string, SupplierSourceCollaborationTaskDto>();
    for (const [index, candidate] of scan.candidates.entries()) {
      const snapshot = scan.snapshots[index]!;
      const facts = await this.prisma.$transaction(async tx => {
        await authenticate(tx);
        const core = candidate.domainCode === 'process-quality' ? this.processCore
          : candidate.domainCode === 'customer-quality' ? this.customerRuntime.core : this.newProductRuntime.core;
        const hasReport = await core.hasReport(tx, organizationId, candidate.problemId);
        const references = await this.model.currentReferences(tx, organizationId, candidate.problemId);
        const selected = await project(tx, references);
        // Re-read current links and exact assignment/role facts before returning this short case transaction.
        await authenticate(tx);
        const stillHasReport = await core.hasReport(tx, organizationId, candidate.problemId);
        const currentReferences = await this.model.currentReferences(tx, organizationId, candidate.problemId);
        const current = await project(tx, currentReferences);
        if (JSON.stringify(references) !== JSON.stringify(snapshot.references)
          || JSON.stringify(currentReferences) !== JSON.stringify(references)
          || JSON.stringify(selected) !== JSON.stringify(snapshot.facts)
          || JSON.stringify(current) !== JSON.stringify(selected)) adminError('CONCURRENCY_CONFLICT', 409);
        return hasReport && stillHasReport ? current : [];
      }, { isolationLevel: 'ReadCommitted' });
      for (const fact of facts) {
        const id = `SOURCE_SQE:${fact.canonicalFactKey}:${fact.materialItemId}`;
        if (items.has(id)) continue;
        if (fact.sourceKind === 'NEW_PRODUCT_SELECTION' && !fact.reviewSource) continue;
        const reviewKind = fact.reviewSource?.kind ?? fact.sourceKind;
        const reviewId = fact.reviewSource?.id ?? fact.sourceId;
        if (!isUUID(reviewId)) continue;
        const route = reviewKind === 'CUSTOMER_LEDGER' ? '/app/customer-quality' : '/app/process-quality';
        const parameter = reviewKind === 'CUSTOMER_LEDGER' ? 'complaintId' : 'defectId';
        items.set(id, { id, kind: 'SOURCE_SQE_COLLABORATION', title: '8D协作跟进', sourceKind: fact.sourceKind, sourceId: fact.sourceId,
          materialItemId: fact.materialItemId, verification: fact.verification, progress: fact.progress, result: fact.result,
          link: `${route}?organizationId=${encodeURIComponent(organizationId)}&${parameter}=${encodeURIComponent(reviewId)}` });
      }
    }
    return { items: [...items.values()], scannedCount: scan.scannedCount, nextCursor: scan.nextCursor };
  }
}
