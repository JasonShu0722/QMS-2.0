import type { Prisma } from '../../generated/prisma/client.js';
import { INTERNAL_PLATFORM_PERMISSION_CODES, PLATFORM_ADMINISTRATOR_PERMISSION, PLATFORM_INACTIVE_MANAGEMENT_PERMISSION_CODES } from '../../modules/authorization/permission-catalog.js';

const roleSelect = {
  id: true, organizationId: true, code: true, name: true, mfaRequired: true,
  permissions: { select: { permission: { select: { id: true, code: true, name: true } } } },
} as const satisfies Prisma.RoleSelect;

type Role = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;
type Source = { kind: 'DIRECT' } | { kind: 'POSITION'; positionId: string; assignmentId: string };
export type PlatformAdministratorScope = { kind: 'PLATFORM_ADMINISTRATOR'; sourceOrganizationIds: string[]; targetOrganizationId: string; coverage: 'INTERNAL_PLATFORM' };
export type EffectiveRoleGrant = { organizationId: string; role: Role; sources: Source[]; platformScope?: PlatformAdministratorScope };
export type EffectiveRoleGrantClient = Pick<Prisma.TransactionClient, 'user' | 'userRole' | 'userPosition' | 'organization' | 'permission'>;

const compare = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;

export function effectivePositionAssignmentWhere(now = new Date()): Prisma.UserPositionWhereInput {
  return {
    startedAt: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }],
    organization: { status: 'ACTIVE' },
    position: { status: 'ACTIVE', department: { status: 'ACTIVE' } },
  };
}

async function readRoleGrants(
  transaction: EffectiveRoleGrantClient,
  userId: string,
  organizationId?: string,
  now = new Date(),
) {
  const direct = await transaction.userRole.findMany({
    where: { userId, ...(organizationId === undefined ? {} : { OR: [{ organizationId }, { role: { permissions: { some: { permission: { code: PLATFORM_ADMINISTRATOR_PERMISSION } } } } }] }) },
    select: { organizationId: true, role: { select: roleSelect } },
  });
  const user = await transaction.user.findUnique({ where: { id: userId }, select: { organizationId: true, status: true, accountType: true, organization: { select: { status: true, type: true } } } });
  const crossScope = organizationId !== undefined && organizationId !== user?.organizationId;
  const assignments = user && (!crossScope || activeInternalUser(user))
    ? await transaction.userPosition.findMany({
      where: {
        userId, organizationId: user.organizationId,
        ...effectivePositionAssignmentWhere(now),
        ...(crossScope ? { position: { status: 'ACTIVE' as const, department: { status: 'ACTIVE' as const }, roles: { some: { role: { permissions: { some: { permission: { code: PLATFORM_ADMINISTRATOR_PERMISSION } } } } } } } } : {}),
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
      if (crossScope && !hasMarker(role)) continue;
      add(assignment.organizationId, role, { kind: 'POSITION', positionId: assignment.positionId, assignmentId: assignment.id });
    }
  }
  for (const grant of grants.values()) {
    grant.sources.sort((a, b) => compare(a.kind, b.kind) ||
      (a.kind === 'POSITION' && b.kind === 'POSITION' ? compare(a.positionId, b.positionId) || compare(a.assignmentId, b.assignmentId) : 0));
  }
  return { user, grants: [...grants.values()] };
}

const hasMarker = (role: Role) => role.permissions.some(({ permission }) => permission.code === PLATFORM_ADMINISTRATOR_PERMISSION);
function activeInternalUser(user: { status: string; accountType: string; organization: { status: string; type: string } } | null) {
  return user?.status === 'ACTIVE' && user.accountType === 'INTERNAL' && user.organization?.status === 'ACTIVE' && user.organization.type === 'INTERNAL';
}
function markerSources(grants: EffectiveRoleGrant[]) {
  return grants.filter(grant => hasMarker(grant.role) && (grant.role.organizationId === null || grant.role.organizationId === grant.organizationId));
}

// Governance needs real memberships, including markers suppressed for a disabled runtime subject.
export async function roleGrantSources(transaction: EffectiveRoleGrantClient, userId: string, now = new Date()): Promise<EffectiveRoleGrant[]> {
  const { grants } = await readRoleGrants(transaction, userId, undefined, now);
  return grants.sort((a, b) => compare(a.organizationId, b.organizationId) || compare(a.role.id, b.role.id));
}

export async function hasPlatformAdministrator(transaction: EffectiveRoleGrantClient, userId: string, now = new Date()): Promise<boolean> {
  const { user, grants } = await readRoleGrants(transaction, userId, undefined, now);
  if (!activeInternalUser(user)) return false;
  const sources = markerSources(grants);
  if (!sources.length) return false;
  const organizations = await transaction.organization.findMany({ where: { id: { in: sources.map(grant => grant.organizationId) }, type: 'INTERNAL', status: 'ACTIVE' }, select: { id: true } });
  return organizations.length > 0;
}

export async function effectiveRoleGrants(transaction: EffectiveRoleGrantClient, userId: string, organizationId?: string, now = new Date()): Promise<EffectiveRoleGrant[]> {
  const { user, grants } = await readRoleGrants(transaction, userId, organizationId, now);
  return projectEffectiveRoleGrants(transaction, user, grants, organizationId);
}

// Candidate appointments use exactly the runtime projection without persisting a user or appointment.
export async function projectEffectiveRoleGrants(transaction: EffectiveRoleGrantClient, user: Parameters<typeof activeInternalUser>[0], grants: EffectiveRoleGrant[], organizationId?: string): Promise<EffectiveRoleGrant[]> {
  const candidates = activeInternalUser(user) ? markerSources(grants) : [];
  // Only explicit marker holders pay for platform target/catalogue reads; never cache revocable grants.
  const organizations = candidates.length ? await transaction.organization.findMany({ where: { type: 'INTERNAL' }, select: { id: true, status: true } }) : [];
  const sources = candidates.filter(grant => organizations.some(({ id, status }) => id === grant.organizationId && status === 'ACTIVE'));
  const result: EffectiveRoleGrant[] = grants.filter(grant => organizationId === undefined || grant.organizationId === organizationId)
    .flatMap(grant => {
      if (!hasMarker(grant.role)) return [{ ...grant, role: { ...grant.role, permissions: [...grant.role.permissions] } }];
      const permissions = grant.role.permissions.filter(({ permission }) => permission.code !== PLATFORM_ADMINISTRATOR_PERMISSION);
      return permissions.length ? [{ ...grant, role: { ...grant.role, permissions } }] : [];
    });
  if (sources.length) {
    const permissions = (await transaction.permission.findMany({ where: { code: { in: INTERNAL_PLATFORM_PERMISSION_CODES } }, select: { id: true, code: true, name: true } }))
      .filter(permission => INTERNAL_PLATFORM_PERMISSION_CODES.includes(permission.code)).map(permission => ({ permission }));
    for (const target of organizations.filter(({ id }) => organizationId === undefined || id === organizationId)) {
      for (const source of sources) {
        let grant = result.find(grant => grant.organizationId === target.id && grant.role.id === source.role.id);
        if (!grant) {
          grant = { ...source, organizationId: target.id, role: { ...source.role, permissions: [] }, sources: [...source.sources] };
          result.push(grant);
        }
        const applicable = target.status === 'ACTIVE' ? permissions : permissions.filter(({ permission }) => PLATFORM_INACTIVE_MANAGEMENT_PERMISSION_CODES.includes(permission.code));
        grant.role.permissions = [...new Map([...grant.role.permissions, ...applicable].map(entry => [entry.permission.code, entry])).values()];
        grant.platformScope = { kind: 'PLATFORM_ADMINISTRATOR', sourceOrganizationIds: [...new Set([...(grant.platformScope?.sourceOrganizationIds ?? []), source.organizationId])].sort(), targetOrganizationId: target.id, coverage: 'INTERNAL_PLATFORM' };
      }
    }
  }
  for (const grant of result) grant.role.permissions.sort((a, b) => compare(a.permission.code, b.permission.code) || compare(a.permission.id, b.permission.id));
  return result.sort((a, b) => compare(a.organizationId, b.organizationId) || compare(a.role.id, b.role.id));
}
