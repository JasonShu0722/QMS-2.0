import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { OrganizationResponsibilityService } from '../organization/organization-responsibility.service.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import type { SupplierEightDActor } from './supplier-eight-d.types.js';
import type { SupplierEightDAssignmentQueryDto } from './supplier-eight-d-assignment.controller.js';

@Injectable()
export class SupplierEightDAssignmentService {
  constructor(private readonly prisma: PrismaService, private readonly directory: OrganizationResponsibilityService) {}
  list(actor: SupplierEightDActor, query: SupplierEightDAssignmentQueryDto) {
    if (actor.accountType !== 'INTERNAL' || actor.scopeOrganizationId && actor.scopeOrganizationId !== actor.organizationId) workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    return this.prisma.$transaction(async tx => {
      const authorize = async () => {
        await assertActiveAuthentication(tx, actor, 'SHARE');
        await assertWorkflowFeature(tx, actor, actor.organizationId, 'supplier-quality:issues:read');
        await assertWorkflowFeature(tx, actor, actor.organizationId, 'supplier-quality:issues:issue');
      };
      await authorize();
      const result = await this.directory.workflowAppointmentOptions(tx, actor.organizationId, query,
        ['supplier-quality:issues:read', 'supplier-quality:issues:work', 'workflow:act']);
      await authorize();
      return result;
    }, { isolationLevel: 'ReadCommitted' });
  }
}
