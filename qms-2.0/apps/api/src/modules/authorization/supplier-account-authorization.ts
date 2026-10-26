import { adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { roleGrantSources } from '../../common/security/effective-role-grants.js';

export const SUPPLIER_ACCOUNT_GOVERNANCE = ['account:users:create', 'account:users:read', 'account:users:reset', 'account:users:status'] as const;
export const SUPPLIER_PORTAL_PERMISSIONS = [
  'supplier-quality:responses:read', 'supplier-quality:responses:write',
  'supplier-performance:portal:cards:read', 'supplier-performance:portal:appeals:read', 'supplier-performance:portal:appeals:write',
  'supplier-admission:submissions:read', 'supplier-admission:submissions:write',
  'supplier-pcn:submissions:read', 'supplier-pcn:submissions:write', 'notification:read', 'workflow:act',
] as const;

export async function assertSupplierAccountGovernance(tx: AdminTransaction, actor: AdminActor, organizationId: string, permission: string) {
  if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
  const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { type: true } });
  if (organization?.type !== 'SUPPLIER') adminError('ADMIN_ACCOUNT_TYPE_ORGANIZATION_MISMATCH', 400);
  return assertAdminAccess(tx, actor, organizationId, permission);
}

export async function assertSupplierAccountTarget(tx: AdminTransaction, actor: AdminActor, organizationId: string, userId: string, permission: string) {
  await assertSupplierAccountGovernance(tx, actor, organizationId, permission);
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  const user = await tx.user.findFirst({ where: { id: userId, organizationId, accountType: 'SUPPLIER' } });
  if (!user) adminError('ADMIN_USER_NOT_FOUND', 404);
  const assignments = await roleGrantSources(tx, userId);
  if (assignments.some(({ role, organizationId: scope }) => scope !== organizationId || role.organizationId !== organizationId
    || role.permissions.some(({ permission: entry }) => !(SUPPLIER_PORTAL_PERMISSIONS as readonly string[]).includes(entry.code)))) adminError('FEATURE_PERMISSION_DENIED', 403);
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
