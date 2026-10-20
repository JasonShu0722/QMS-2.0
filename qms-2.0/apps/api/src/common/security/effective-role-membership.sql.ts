import { Prisma } from '../../generated/prisma/client.js';

// SQL counterpart of effectiveRoleGrants/effectivePositionAssignmentWhere.
export function effectiveRoleMembershipSql(
  userId: Prisma.Sql,
  organizationId: Prisma.Sql,
  // Recheck expiry using the new statement's time after transactional lock waits.
  now: Prisma.Sql = Prisma.sql`statement_timestamp()`,
): Prisma.Sql {
  return Prisma.sql`
    SELECT effective_direct.role_id FROM user_roles effective_direct
    WHERE effective_direct.user_id = ${userId} AND effective_direct.organization_id = ${organizationId}
    UNION
    SELECT effective_binding.role_id FROM user_positions effective_assignment
    JOIN users effective_actor ON effective_actor.id = effective_assignment.user_id
      AND effective_actor.organization_id = effective_assignment.organization_id
    JOIN organizations effective_home ON effective_home.id = effective_assignment.organization_id
    JOIN positions effective_position ON effective_position.id = effective_assignment.position_id
      AND effective_position.organization_id = effective_assignment.organization_id
    JOIN departments effective_department ON effective_department.id = effective_position.department_id
      AND effective_department.organization_id = effective_position.organization_id
    JOIN position_roles effective_binding ON effective_binding.position_id = effective_position.id
      AND effective_binding.organization_id = effective_position.organization_id
    WHERE effective_assignment.user_id = ${userId} AND effective_assignment.organization_id = ${organizationId}
      AND effective_assignment.started_at <= ${now}
      AND (effective_assignment.ended_at IS NULL OR effective_assignment.ended_at > ${now})
      AND effective_home.status = 'ACTIVE' AND effective_position.status = 'ACTIVE' AND effective_department.status = 'ACTIVE'
  `;
}
