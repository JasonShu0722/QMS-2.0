import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from './database/prisma.service.js';
import { AdminMutationService, adminError, type AdminActor } from './common/security/admin-mutation.service.js';
import { CUSTOMER_EIGHT_D_RUNTIME, NEW_PRODUCT_EIGHT_D_RUNTIME, type InternalEightDRuntime } from './common/eight-d/internal-eight-d-runtime.js';
import { INTERNAL_EIGHT_D_DOMAINS } from './common/eight-d/internal-eight-d-domain.js';
import { ProcessEightDService } from './modules/process-quality/process-eight-d.service.js';
import { SupplierEightDService } from './modules/supplier-quality/supplier-eight-d.service.js';
import { OrganizationReconfigurationService } from './modules/organization/organization-reconfiguration.service.js';
import { OrganizationResponsibilityService } from './modules/organization/organization-responsibility.service.js';
import type { InternalEightDAdministrativeQueryDto, InternalEightDAdministrativePendingPageDto } from './common/eight-d/internal-eight-d-administrative.dto.js';
import type { SupplierEightDAdministrativePageDto } from './modules/supplier-quality/supplier-eight-d-administrative.dto.js';
import { AdministrativeProblemDomain as Domain, AdministrativeProblemDuty as Duty,
  type AdministrativeProblemAssignmentQueryDto, type AdministrativeProblemReconfigureDto } from './administrative-problem-reconfiguration.dto.js';

@Injectable()
export class AdministrativeProblemReconfigurationService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService,
    private readonly organizations: OrganizationReconfigurationService, private readonly responsibilities: OrganizationResponsibilityService,
    private readonly process: ProcessEightDService, private readonly supplier: SupplierEightDService,
    @Inject(CUSTOMER_EIGHT_D_RUNTIME) private readonly customer: InternalEightDRuntime,
    @Inject(NEW_PRODUCT_EIGHT_D_RUNTIME) private readonly newProduct: InternalEightDRuntime) {}

  private core(domain: Exclude<Domain, Domain.SUPPLIER>) {
    return domain === Domain.PROCESS ? this.process : domain === Domain.CUSTOMER ? this.customer.core : this.newProduct.core;
  }
  pending(actor: AdminActor, domain: Domain, query: InternalEightDAdministrativeQueryDto) {
    return this.prisma.$transaction<InternalEightDAdministrativePendingPageDto | SupplierEightDAdministrativePageDto>(tx => domain === Domain.SUPPLIER ? this.supplier.administrativePending(tx, actor, query)
      : this.core(domain).administrativePending(tx, actor, query), { isolationLevel: 'ReadCommitted' });
  }
  assignments(actor: AdminActor, domain: Domain, query: AdministrativeProblemAssignmentQueryDto) {
    return this.prisma.$transaction(async tx => {
      await this.organizations.authorize(tx, actor, true);
      if (actor.scopeOrganizationId && actor.scopeOrganizationId !== query.organizationId) adminError('ORGANIZATION_SCOPE_DENIED', 403);
      await this.organizations.scope(tx, query.organizationId, true, false);
      if (domain === Domain.SUPPLIER && query.duty === Duty.OWNER || domain !== Domain.SUPPLIER && query.duty === Duty.RESPONDER) adminError('STRUCTURE_REFERENCE_INVALID', 400);
      const prefix = domain === Domain.SUPPLIER ? 'supplier-quality:issues' : INTERNAL_EIGHT_D_DOMAINS[domain].permissionPrefix;
      const permissions = query.duty === Duty.RESPONDER ? ['supplier-quality:responses:read', 'supplier-quality:responses:write', 'supplier-quality:issues:read', 'workflow:act']
        : query.duty === Duty.OWNER || domain === Domain.SUPPLIER ? [`${prefix}:read`, `${prefix}:work`, 'workflow:act'] : [`${prefix}:read`, `${prefix}:issue`, 'workflow:act'];
      return this.responsibilities.workflowAppointmentOptions(tx, query.organizationId,
        { search: query.search, limit: query.pageSize, offset: query.offset }, permissions);
    }, { isolationLevel: 'ReadCommitted' });
  }
  reconfigure(actor: AdminActor, domain: Domain, id: string, input: AdministrativeProblemReconfigureDto, traceId: string, key?: string) {
    return this.mutations.run({ actor, organizationId: actor.organizationId, permission: 'organization:reconfigure', key, traceId,
      action: 'EIGHT_D_ADMINISTRATIVELY_RECONFIGURED', payload: { domain, id, scopeOrganizationId: actor.scopeOrganizationId, ...input }, isolationLevel: 'ReadCommitted' }, async tx => {
      if (domain === Domain.SUPPLIER) {
        if (!input.sqeAssignmentId || input.ownerAssignmentId !== undefined || input.professionalAssignmentId !== undefined) adminError('STRUCTURE_REFERENCE_INVALID', 400);
        return this.supplier.administrativeReconfigure(tx, actor, id, { expectedVersion: input.expectedVersion,
          sqeAssignmentId: input.sqeAssignmentId, ...(input.internalResponderAssignmentId ? { internalResponderAssignmentId: input.internalResponderAssignmentId } : {}) }, traceId);
      }
      if (input.sqeAssignmentId !== undefined || input.internalResponderAssignmentId !== undefined) adminError('STRUCTURE_REFERENCE_INVALID', 400);
      return this.core(domain).administrativeReconfigure(tx, actor, id, { expectedVersion: input.expectedVersion,
        ...(input.professionalAssignmentId ? { professionalAssignmentId: input.professionalAssignmentId } : {}),
        ...(input.ownerAssignmentId ? { ownerAssignmentId: input.ownerAssignmentId } : {}) }, traceId);
    }, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('administrative-lifecycle', 0))::text`;
      await this.organizations.authorize(tx, actor, true);
      if (actor.scopeOrganizationId) {
        const organizationId = domain === Domain.SUPPLIER
          ? await this.supplier.administrativeOrganizationId(tx, actor, id)
          : await this.core(domain).readResourceOrganizationId(tx, id);
        if (organizationId !== actor.scopeOrganizationId) adminError('ORGANIZATION_SCOPE_DENIED', 403);
      }
    });
  }
}
