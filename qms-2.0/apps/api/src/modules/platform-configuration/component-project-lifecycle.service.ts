import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { AdminActor } from '../../common/security/admin-mutation.service.js';
import { AdministrativeLifecycleRegistry } from '../../common/security/administrative-lifecycle.registry.js';
import type { AdministrativeLifecycleEffect, AdministrativeLifecycleImpact } from '../../common/security/administrative-lifecycle.types.js';
import { OrganizationService } from '../organization/organization.service.js';

@Injectable()
export class ComponentProjectLifecycleService implements AdministrativeLifecycleEffect {
  readonly module = 'platform-configuration' as const;

  constructor(registry: AdministrativeLifecycleRegistry, private readonly organizations: OrganizationService) {
    registry.register(this);
  }

  async apply(tx: Prisma.TransactionClient, actor: AdminActor, impact: AdministrativeLifecycleImpact) {
    const assignmentIds = await this.organizations.administrativeAssignmentIds(tx, impact);
    const assignments = assignmentIds.length ? Prisma.join(assignmentIds.map(id => Prisma.sql`${id}::uuid`)) : Prisma.sql`NULL`;
    const customer = assignmentIds.length ? Prisma.sql`customer_engineer_assignment_id IN (${assignments})` : Prisma.sql`FALSE`;
    const engineer = assignmentIds.length ? Prisma.sql`project_engineer_assignment_id IN (${assignments})` : Prisma.sql`FALSE`;
    const organizationIds = impact.kind === 'ORGANIZATION' ? impact.organizationIds : [];
    const disable = organizationIds.length
      ? Prisma.sql`organization_id IN (${Prisma.join(organizationIds.map(id => Prisma.sql`${id}::uuid`))})`
      : Prisma.sql`FALSE`;
    const records = await tx.$executeRaw`UPDATE component_project_records SET
      customer_engineer_assignment_id = CASE WHEN ${customer} THEN NULL ELSE customer_engineer_assignment_id END,
      project_engineer_assignment_id = CASE WHEN ${engineer} THEN NULL ELSE project_engineer_assignment_id END,
      status = CASE WHEN ${disable} THEN 'DISABLED' ELSE status END,
      version = version + 1, updated_by_user_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP
      WHERE ${customer} OR ${engineer} OR (${disable} AND status <> 'DISABLED')`;
    const mappings = organizationIds.length ? await tx.$executeRaw`UPDATE component_project_mappings SET
      status = 'DISABLED', version = version + 1, updated_by_user_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP
      WHERE ${disable} AND status <> 'DISABLED'` : 0;
    const changed = records + mappings;
    return { module: this.module, changed, pendingConfiguration: changed };
  }
}
