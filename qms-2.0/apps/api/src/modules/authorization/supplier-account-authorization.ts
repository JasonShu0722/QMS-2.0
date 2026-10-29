import { adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { roleGrantSources } from '../../common/security/effective-role-grants.js';
import { hasPlatformAdministrator } from '../../common/security/platform-administrator.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';

export const SUPPLIER_ACCOUNT_GOVERNANCE = ['account:users:create', 'account:users:read', 'account:users:reset', 'account:users:status'] as const;
export const SUPPLIER_PORTAL_PERMISSIONS = [
  'supplier-quality:responses:read', 'supplier-quality:responses:write',
  'supplier-performance:portal:cards:read', 'supplier-performance:portal:appeals:read', 'supplier-performance:portal:appeals:write',
  'supplier-admission:submissions:read', 'supplier-admission:submissions:write',
  'supplier-pcn:submissions:read', 'supplier-pcn:submissions:write', 'notification:read', 'workflow:act',
] as const;

export async function assertSupplierAccountGovernance(tx: AdminTransaction, actor: AdminActor, organizationId: string, permission: string, ownerOrganizationId?: string) {
  if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
  const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { type: true, status: true, deletedAt: true } });
  if (organization?.type !== 'SUPPLIER') adminError('ADMIN_ACCOUNT_TYPE_ORGANIZATION_MISMATCH', 400);
  if (organization.deletedAt || organization.status !== 'ACTIVE') adminError('ORGANIZATION_DISABLED', 403);
  // Only the profile owner may supply this server-side context, never an HTTP flag.
  if (ownerOrganizationId !== undefined && await hasPlatformAdministrator(tx, actor.id)) {
    const authentication = await assertActiveAuthentication(tx, actor);
    if (authentication.user.accountType !== 'INTERNAL' || authentication.user.organizationId !== actor.organizationId
      || ownerOrganizationId !== (actor.scopeOrganizationId ?? actor.organizationId)) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    const owner = await tx.organization.findUnique({ where: { id: ownerOrganizationId }, select: { type: true, status: true, deletedAt: true } });
    if (owner?.type !== 'INTERNAL' || owner.status !== 'ACTIVE' || owner.deletedAt) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    return assertAdminAccess(tx, actor, ownerOrganizationId, [permission === 'account:users:read' ? 'supplier-quality:profiles:read' : 'supplier-quality:profiles:write', permission]);
  }
  return assertAdminAccess(tx, actor, organizationId, permission);
}

export async function assertSupplierAccountTarget(tx: AdminTransaction, actor: AdminActor, organizationId: string, userId: string, permission: string, ownerOrganizationId?: string) {
  await assertSupplierAccountGovernance(tx, actor, organizationId, permission, ownerOrganizationId);
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  const user = await tx.user.findFirst({ where: { id: userId, organizationId, accountType: 'SUPPLIER', deletedAt: null } });
  if (!user) adminError('ADMIN_USER_NOT_FOUND', 404);
  const assignments = await roleGrantSources(tx, userId);
  if (assignments.some(({ role, organizationId: scope }) => scope !== organizationId || role.organizationId !== organizationId
    || role.permissions.some(({ permission: entry }) => !(SUPPLIER_PORTAL_PERMISSIONS as readonly string[]).includes(entry.code)))) adminError('FEATURE_PERMISSION_DENIED', 403);
  await assertSupplierAccountGovernance(tx, actor, organizationId, permission, ownerOrganizationId);
  return user;
}

export async function grantSupplierBoundaryCaretaker(tx: AdminTransaction, actor: AdminActor, ownerOrganizationId: string, organizationId: string) {
  if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
  const granted = await assertAdminAccess(tx, actor, ownerOrganizationId, ['supplier-quality:profiles:write', 'account:users:create']);
  const permissions = await tx.permission.findMany({ where: { code: { in: SUPPLIER_ACCOUNT_GOVERNANCE.filter((permission) => granted.includes(permission)) } } });
  const role = await tx.role.create({ data: { organizationId, code: `SUPPLIER_CARETAKER_${actor.id}`, name: 'Supplier account caretaker', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
  await tx.userRole.create({ data: { userId: actor.id, organizationId, roleId: role.id } });
}

export async function assignSupplierPortalRole(tx: AdminTransaction, organizationId: string, userId: string) {
  const code = 'SUPPLIER_PORTAL_STAFF';
  const permissions = await tx.permission.findMany({ where: { code: { in: [...SUPPLIER_PORTAL_PERMISSIONS] } } });
  if (permissions.length !== SUPPLIER_PORTAL_PERMISSIONS.length) adminError('FEATURE_PERMISSION_DENIED', 403);
  const role = await tx.role.upsert({ where: { organizationId_code: { organizationId, code } }, update: {}, create: { organizationId, code, name: 'Supplier portal staff', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } }, include: { permissions: { include: { permission: true } } } });
  const codes = role.permissions.map(({ permission }) => permission.code);
  if (codes.some((permission) => !(SUPPLIER_PORTAL_PERMISSIONS as readonly string[]).includes(permission))) adminError('FEATURE_PERMISSION_DENIED', 403);
  const missing = permissions.filter(({ code: permission }) => !codes.includes(permission));
  if (missing.length === 1 && missing[0]!.code === 'workflow:act') {
    await tx.rolePermission.createMany({ data: [{ roleId: role.id, permissionId: missing[0]!.id }], skipDuplicates: true });
  } else if (missing.length) adminError('FEATURE_PERMISSION_DENIED', 403);
  await tx.userRole.create({ data: { userId, organizationId, roleId: role.id } });
}
