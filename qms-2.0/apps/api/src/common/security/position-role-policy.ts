import { Prisma } from '../../generated/prisma/client.js';
import { adminError, type AdminTransaction } from './admin-mutation.service.js';
import { SUPPLIER_PORTAL_PERMISSIONS } from '../../modules/authorization/supplier-account-authorization.js';
import { ACTIVE_PERMISSION_CODES } from '../../modules/authorization/permission-catalog.js';

export async function assertNoCanonicalRole(transaction: AdminTransaction, roleIds: string[]) {
  if (roleIds.length && await transaction.role.count({ where: { id: { in: roleIds }, archivedAt: { not: null } } })) adminError('FEATURE_PERMISSION_DENIED', 403);
  if (roleIds.length && await transaction.positionRole.count({ where: { isCanonical: true, roleId: { in: roleIds } } })) {
    adminError('FEATURE_PERMISSION_DENIED', 403);
  }
}

export async function assertLegacyPositionRoleWrite(transaction: AdminTransaction, organizationId: string, positionId: string, roleIds: string[]) {
  if (await transaction.positionRole.count({ where: { organizationId, positionId, isCanonical: true } })) adminError('FEATURE_PERMISSION_DENIED', 403);
  await assertNoCanonicalRole(transaction, roleIds);
}

// Public transactional projection; OrganizationModule must not import AuthorizationModule.
export async function positionRoleDefinitions(transaction: AdminTransaction, organizationId: string, roleIds: string[], lock = false) {
  const ids = [...new Set(roleIds)].sort();
  if (!ids.length) return [];
  if (lock) {
    await transaction.$queryRaw(Prisma.sql`SELECT id FROM roles WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
  }
  const roles = await transaction.role.findMany({
    where: { organizationId, id: { in: ids }, archivedAt: null },
    select: {
      id: true, organizationId: true, code: true, name: true, mfaRequired: true,
      permissions: { select: { permission: { select: { id: true, code: true, name: true } } }, orderBy: { permission: { code: 'asc' } } },
    },
    orderBy: [{ code: 'asc' }, { id: 'asc' }],
  });
  if (roles.length !== ids.length) adminError('ADMIN_ROLE_NOT_FOUND', 404);
  return roles.map((role) => ({ ...role, permissions: role.permissions.map(({ permission }) => permission) }));
}

export function assertPositionRoleCeiling(roles: Awaited<ReturnType<typeof positionRoleDefinitions>>, granted: string[], organizationType: 'INTERNAL' | 'SUPPLIER') {
  if (roles.some((role) => role.permissions.some(({ code }) => !granted.includes(code)
    || (organizationType === 'SUPPLIER' && !(SUPPLIER_PORTAL_PERMISSIONS as readonly string[]).includes(code))))) {
    adminError('FEATURE_PERMISSION_DENIED', 403);
  }
}

export function assertPositionRolesGrantable(roles: Awaited<ReturnType<typeof positionRoleDefinitions>>) {
  if (roles.some((role) => role.permissions.some(({ code }) => !ACTIVE_PERMISSION_CODES.includes(code)))) {
    adminError('ADMIN_PERMISSION_NOT_FOUND', 400);
  }
}
