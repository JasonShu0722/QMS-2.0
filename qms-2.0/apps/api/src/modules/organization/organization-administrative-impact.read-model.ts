import { Prisma } from '../../generated/prisma/client.js';

// Server-authorized lifecycle callers compose this relation in their own transaction.
// Saved sources must remain matchable even when their appointment/position has just become unavailable.
export function organizationAdministrativeAffectedAssignments(
  organizationId: string, departmentIds: readonly string[], positionIds: readonly string[],
): Prisma.Sql {
  return Prisma.sql`SELECT up.organization_id, up.id AS assignment_id, up.user_id, b.department_id AS section_department_id
    FROM user_positions up JOIN positions p ON p.id = up.position_id AND p.organization_id = up.organization_id
    LEFT JOIN department_management_bindings b ON b.organization_id = up.organization_id AND b.position_id = up.position_id
      AND b.responsibility = 'SECTION_MANAGER' AND b.status = 'ACTIVE'
    WHERE up.organization_id = ${organizationId}::uuid
      AND (p.department_id = ANY(${[...departmentIds]}::uuid[]) OR up.position_id = ANY(${[...positionIds]}::uuid[]))`;
}
