import { adminError } from '../../common/security/admin-mutation.service.js';
import { effectiveRoleGrants, type EffectiveRoleGrantClient } from '../../common/security/effective-role-grants.js';
import { hasPlatformAdministrator } from '../../common/security/platform-administrator.js';
import { ADMIN_PERMISSIONS, ADMINISTRATIVE_LIFECYCLE_PERMISSION_CODES, PLATFORM_INACTIVE_MANAGEMENT_PERMISSION_CODES } from '../authorization/permission-catalog.js';
import type { AuthorizedSessionUser } from '../authorization/authorization.service.js';
import type { AdminOrganizationContextDto } from './dto/admin-user.dto.js';

const managementPermissions = new Set([
  ...ADMIN_PERMISSIONS, 'organization:read',
  ...ADMINISTRATIVE_LIFECYCLE_PERMISSION_CODES,
  'component-project:read', 'component-project:manage', 'customer-quality:complaints:read', 'customer-quality:complaints:write',
  'material-master:read', 'material-master:write', 'material-master:import',
  'supplier-quality:profiles:read', 'supplier-quality:profiles:write',
]);

export async function adminOrganizationContext(
  prisma: EffectiveRoleGrantClient,
  actor: AuthorizedSessionUser,
  targetOrganizationId = actor.organizationId,
): Promise<AdminOrganizationContextDto> {
  if (actor.accountType === 'SUPPLIER' && targetOrganizationId !== actor.organizationId) adminError('ORGANIZATION_SCOPE_DENIED', 403);
  const now = new Date();
  const grants = await effectiveRoleGrants(prisma, actor.id, targetOrganizationId, now);
  // Match the existing scope seam before looking up target metadata, including nonexistent UUIDs.
  if (targetOrganizationId !== actor.organizationId && !grants.length) adminError('ORGANIZATION_SCOPE_DENIED', 403);
  const target = await prisma.organization.findUnique({ where: { id: targetOrganizationId }, select: { status: true, deletedAt: true, configurationRequired: true } });
  if (!target || target.deletedAt) adminError('ORGANIZATION_NOT_FOUND', 404);
  const platformAdministrator = await hasPlatformAdministrator(prisma, actor.id, now);
  const canManageOrganization = grants.some(grant => grant.role.permissions.some(({ permission }) => permission.code === 'organization:manage'));
  const allowed = (code: string) => managementPermissions.has(code)
    && (platformAdministrator || !ADMINISTRATIVE_LIFECYCLE_PERMISSION_CODES.includes(code)) && (target.status === 'ACTIVE'
    || (platformAdministrator ? PLATFORM_INACTIVE_MANAGEMENT_PERMISSION_CODES.includes(code)
      : code === 'organization:manage' || code === 'organization:read' && canManageOrganization));
  const sources = grants.filter(grant => grant.role.permissions.some(({ permission }) => allowed(permission.code)));
  const permissions = [...new Set(sources.flatMap(grant => grant.role.permissions.map(({ permission }) => permission.code).filter(allowed)))].sort();
  return {
    hasPlatformAdministrator: platformAdministrator,
    homeOrganizationId: actor.organizationId,
    targetOrganizationId,
    accessKind: sources.some(grant => grant.platformScope) ? 'PLATFORM' : permissions.length ? 'ORGANIZATION' : 'NONE',
    targetOrganizationStatus: target.status,
    targetConfigurationRequired: target.configurationRequired,
    permissions,
    authorizationSources: sources.map(grant => ({
      roleId: grant.role.id, roleCode: grant.role.code, roleName: grant.role.name,
      sourceOrganizationIds: grant.platformScope?.sourceOrganizationIds ?? [grant.organizationId],
      sourceKinds: [...new Set(grant.sources.map(source => source.kind))].sort(),
      platformAdministrator: !!grant.platformScope,
    })),
  };
}
