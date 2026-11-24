import { Prisma, type Organization } from '../../generated/prisma/client.js';
import type { AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { effectivePositionAssignmentWhere } from '../../common/security/effective-role-grants.js';

export type OrganizationRuntime = Pick<Organization, 'id' | 'type' | 'status' | 'deletedAt' | 'configurationRequired'>;

export function listEffectiveOrganizationPositions(transaction: AdminTransaction, organizationId: string) {
  return transaction.position.findMany({ where: { ...effectivePositionAssignmentWhere().position, organizationId },
    select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
}

export async function listEffectiveUserPositionIds(transaction: AdminTransaction, organizationId: string, userId: string, positionIds: string[]) {
  const assignments = await transaction.userPosition.findMany({ where: { ...effectivePositionAssignmentWhere(), organizationId, userId,
    positionId: { in: positionIds }, user: { accountType: 'INTERNAL', organizationId, status: 'ACTIVE', deletedAt: null, configurationRequired: false } },
  select: { positionId: true } });
  return assignments.map(assignment => assignment.positionId);
}

export async function readOrganizationRuntime(transaction: AdminTransaction, organizationId: string, lock = false): Promise<OrganizationRuntime | null> {
  const [organization] = await transaction.$queryRaw<OrganizationRuntime[]>(Prisma.sql`
    SELECT id, type, status, deleted_at AS "deletedAt", configuration_required AS "configurationRequired"
    FROM organizations WHERE id = ${organizationId}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
  return organization ?? null;
}
