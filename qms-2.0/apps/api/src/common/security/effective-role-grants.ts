import type { Prisma } from '../../generated/prisma/client.js';

const roleSelect = {
  id: true, organizationId: true, code: true, name: true, mfaRequired: true,
  permissions: { select: { permission: { select: { id: true, code: true, name: true } } } },
} as const satisfies Prisma.RoleSelect;

type Role = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;
type Source = { kind: 'DIRECT' } | { kind: 'POSITION'; positionId: string; assignmentId: string };
export type EffectiveRoleGrant = { organizationId: string; role: Role; sources: Source[] };
export type EffectiveRoleGrantClient = Pick<Prisma.TransactionClient, 'user' | 'userRole' | 'userPosition'>;

const compare = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;

export async function effectiveRoleGrants(
  transaction: EffectiveRoleGrantClient,
  userId: string,
  organizationId?: string,
  now = new Date(),
): Promise<EffectiveRoleGrant[]> {
  const direct = await transaction.userRole.findMany({
    where: { userId, ...(organizationId === undefined ? {} : { organizationId }) },
    select: { organizationId: true, role: { select: roleSelect } },
  });
  const user = await transaction.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
  const assignments = user && (organizationId === undefined || organizationId === user.organizationId)
    ? await transaction.userPosition.findMany({
      where: {
        userId, organizationId: user.organizationId,
        startedAt: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }],
        organization: { status: 'ACTIVE' },
        position: { status: 'ACTIVE', department: { status: 'ACTIVE' } },
      },
      select: {
        id: true, organizationId: true, positionId: true,
        position: { select: { roles: { select: { role: { select: roleSelect } } } } },
      },
    }) : [];

  const grants = new Map<string, EffectiveRoleGrant>();
  function add(scope: string, role: Role, source: Source) {
    const key = `${scope}:${role.id}`;
    const existing = grants.get(key);
    if (existing) existing.sources.push(source);
    else grants.set(key, {
      organizationId: scope,
      role: {
        ...role,
        permissions: [...role.permissions].sort((a, b) => compare(a.permission.code, b.permission.code) || compare(a.permission.id, b.permission.id)),
      },
      sources: [source],
    });
  }

  for (const { organizationId: scope, role } of direct) add(scope, role, { kind: 'DIRECT' });
  for (const assignment of assignments) {
    for (const { role } of assignment.position.roles) {
      add(assignment.organizationId, role, { kind: 'POSITION', positionId: assignment.positionId, assignmentId: assignment.id });
    }
  }
  for (const grant of grants.values()) {
    grant.sources.sort((a, b) => compare(a.kind, b.kind) ||
      (a.kind === 'POSITION' && b.kind === 'POSITION' ? compare(a.positionId, b.positionId) || compare(a.assignmentId, b.assignmentId) : 0));
  }
  return [...grants.values()].sort((a, b) => compare(a.organizationId, b.organizationId) || compare(a.role.id, b.role.id));
}
