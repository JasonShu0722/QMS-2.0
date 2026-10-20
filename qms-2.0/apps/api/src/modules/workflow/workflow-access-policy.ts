import { Prisma } from '../../generated/prisma/client.js';
import { effectiveRoleMembershipSql } from '../../common/security/effective-role-membership.sql.js';
import type { AuthorizedSessionUser } from '../authorization/authorization.service.js';
import { workflowError } from './workflow-runtime-policy.js';

export type WorkflowActor = AuthorizedSessionUser & { sessionId: string };

export function featurePredicate(userId: Prisma.Sql, organizationId: Prisma.Sql, permission: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM roles role
    JOIN role_permissions grant_record ON grant_record.role_id = role.id
    JOIN permissions permission ON permission.id = grant_record.permission_id
    WHERE role.id IN (${effectiveRoleMembershipSql(userId, organizationId)})
      AND (role.organization_id = ${organizationId} OR role.organization_id IS NULL)
      AND permission.code = ${permission}
  )`;
}

export function activeActorPredicate(userId: Prisma.Sql, organizationId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM users actor
    JOIN organizations home ON home.id = actor.organization_id
    JOIN organizations target ON target.id = ${organizationId}
    WHERE actor.id = ${userId} AND actor.status = 'ACTIVE' AND home.status = 'ACTIVE' AND target.status = 'ACTIVE'
      AND (actor.account_type = 'INTERNAL' OR actor.organization_id = ${organizationId})
  )`;
}

export function assignmentPredicate(userId: Prisma.Sql, organizationId: Prisma.Sql, raw: Prisma.Sql): Prisma.Sql {
  const assignment = Prisma.sql`(CASE WHEN jsonb_typeof(${raw}) = 'string' THEN jsonb_build_object('roleCode', ${raw}) ELSE ${raw} END)`;
  return Prisma.sql`(
    jsonb_typeof(${assignment}) = 'object'
    AND (${assignment} ? 'roleCode' OR ${assignment} ? 'assigneeUserId' OR ${assignment} ? 'permission')
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(${assignment}) = 'object' THEN ${assignment} ELSE '{}'::jsonb END) constraint_value
      WHERE constraint_value.key IN ('roleCode', 'assigneeUserId', 'permission')
        AND (jsonb_typeof(constraint_value.value) <> 'string' OR btrim(constraint_value.value #>> '{}') = '')
    )
    AND (NOT ${assignment} ? 'assigneeUserId' OR ${assignment}->>'assigneeUserId' = ${userId}::text)
    AND (NOT ${assignment} ? 'roleCode' OR EXISTS (
      SELECT 1 FROM roles role
      WHERE role.id IN (${effectiveRoleMembershipSql(userId, organizationId)})
        AND (role.organization_id = ${organizationId} OR role.organization_id IS NULL)
        AND role.code = ${assignment}->>'roleCode'
    ))
    AND (NOT ${assignment} ? 'permission' OR ${featurePredicate(userId, organizationId, Prisma.sql`${assignment}->>'permission'`)})
  )`;
}

export function workflowAccessPredicate(userId: Prisma.Sql, organizationId: Prisma.Sql, assignment: Prisma.Sql, permission = 'workflow:act'): Prisma.Sql {
  return Prisma.sql`(${activeActorPredicate(userId, organizationId)} AND ${featurePredicate(userId, organizationId, Prisma.sql`${permission}`)} AND ${assignmentPredicate(userId, organizationId, assignment)})`;
}

export async function assertWorkflowFeature(tx: Prisma.TransactionClient, actor: AuthorizedSessionUser, organizationId: string, permission: string): Promise<void> {
  const current = await tx.user.findUnique({ where: { id: actor.id }, include: { organization: true } });
  if (!current || current.status !== 'ACTIVE' || current.organizationId !== actor.organizationId || current.accountType !== actor.accountType) workflowError('AUTH_SESSION_REQUIRED', 401);
  if (current.organization.status !== 'ACTIVE') workflowError('ORGANIZATION_DISABLED', 403);
  if (current.accountType === 'SUPPLIER' && current.organizationId !== organizationId) workflowError('ORGANIZATION_SCOPE_DENIED', 403);
  const target = await tx.organization.findUnique({ where: { id: organizationId } });
  if (target?.status !== 'ACTIVE') workflowError('ORGANIZATION_DISABLED', 403);
  const [result] = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT ${featurePredicate(Prisma.sql`${actor.id}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`${permission}`)} AS allowed`);
  if (!result?.allowed) workflowError('FEATURE_PERMISSION_DENIED', 403);
}

export async function canProcessWorkflowNode(tx: Prisma.TransactionClient, userId: string, organizationId: string, assignment: unknown): Promise<boolean> {
  const [result] = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT ${workflowAccessPredicate(Prisma.sql`${userId}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`${JSON.stringify(assignment ?? null)}::jsonb`)} AS allowed`);
  return result?.allowed === true;
}
