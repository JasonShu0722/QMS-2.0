import { adminError, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import type { OrganizationLifecycleDto } from './organization.dto.js';

export const organizationGovernancePermissions = ['organization:read', 'organization:manage', 'organization:structure:read', 'organization:structure:manage', 'organization:positions:assign'];
type Organization = { id: string; parentId: string | null; type: string; createdAt?: Date };
type Initialization = { roleId: string | null; creatorUserId: string; permissionCodes: string[]; grantUserId: string | null; grantRoleId: string | null; grantOrganizationId: string | null };

export async function recordOrganizationInitialization(transaction: AdminTransaction, organization: Organization & { code: string; name: string }, roleId: string, creatorUserId: string, permissionCodes: string[], creationKey: string) {
  await transaction.$executeRaw`
    INSERT INTO organization_initializations (organization_id, role_id, creator_user_id, permission_codes,
      original_organization, grant_user_id, grant_role_id, grant_organization_id)
    VALUES (${organization.id}::uuid, ${roleId}::uuid, ${creatorUserId}::uuid, ${permissionCodes}::text[],
      ${JSON.stringify({ ...organization, creationKey, structureGovernorRoleId: roleId })}::jsonb,
      ${creatorUserId}::uuid, ${roleId}::uuid, ${organization.id}::uuid)`;
}

export async function rejectDeletedOrganizationCreation(transaction: AdminTransaction, creatorUserId: string, parentId: string, key: string) {
  const [row] = await transaction.$queryRaw<{ deleted: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM organization_initializations s
      WHERE s.creator_user_id = ${creatorUserId}::uuid AND s.original_organization->>'parentId' = ${parentId}
        AND s.original_organization->>'creationKey' = ${key}
        AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = s.organization_id)) AS deleted`;
  if (row?.deleted) adminError('STRUCTURE_REFERENCE_INVALID', 409);
}

export async function organizationInitialization(transaction: AdminTransaction, organization: Organization) {
  const [source] = await transaction.$queryRaw<Initialization[]>`
    SELECT role_id AS "roleId", creator_user_id AS "creatorUserId", permission_codes AS "permissionCodes",
      grant_user_id AS "grantUserId", grant_role_id AS "grantRoleId", grant_organization_id AS "grantOrganizationId"
    FROM organization_initializations WHERE organization_id = ${organization.id}::uuid`;
  const roles = await transaction.role.findMany({ where: { organizationId: organization.id }, include: { permissions: { include: { permission: true } }, userRoles: true, positions: true } });
  const grants = await transaction.userRole.findMany({ where: { organizationId: organization.id } });
  let provenance: Initialization | undefined = source;
  if (!source && roles.length) {
    const events = await transaction.auditEvent.findMany({ where: { organizationId: organization.id, resourceId: organization.id, resourceType: 'Organization', action: 'ORGANIZATION_CREATED', outcome: 'SUCCESS' } });
    const event = events.length === 1 ? events[0] : undefined;
    const metadata = event?.metadata as Record<string, unknown> | undefined;
    const role = roles.length === 1 ? roles[0] : undefined;
    if (event?.actorUserId && metadata?.resourceVersion === 1) {
      if (metadata.organizationId === organization.id && typeof metadata.structureGovernorRoleId === 'string'
        && typeof metadata.structureCode === 'string' && typeof metadata.structureName === 'string'
        && typeof metadata.permissionCode === 'string') {
        provenance = { roleId: metadata.structureGovernorRoleId, creatorUserId: event.actorUserId,
          permissionCodes: metadata.permissionCode.split(','), grantUserId: event.actorUserId,
          grantRoleId: metadata.structureGovernorRoleId, grantOrganizationId: organization.id };
      } else if (Object.keys(metadata).length === 1 && role && organization.parentId) {
        const receipts = await transaction.adminMutation.findMany({ where: { organizationId: organization.parentId,
          actorUserId: event.actorUserId, action: 'ORGANIZATION_CREATED', response: { path: ['value', 'id'], equals: organization.id } } });
        const created = receipts.length === 1 ? (receipts[0]!.response as { value?: Record<string, unknown> }).value : undefined;
        if (created?.id === organization.id && created.parentId === organization.parentId && created.type === organization.type
          && created.version === 1 && created.status === 'ACTIVE' && typeof created.code === 'string' && typeof created.name === 'string'
          && Object.keys(created).sort().join(',') === 'code,id,name,parentId,status,type,version'
          && organization.createdAt?.getTime() === role.createdAt.getTime()
          && role.createdAt.getTime() === event.createdAt.getTime() && event.createdAt.getTime() === receipts[0]!.createdAt.getTime()) {
          provenance = { roleId: role.id, creatorUserId: event.actorUserId, permissionCodes: organizationGovernancePermissions,
            grantUserId: event.actorUserId, grantRoleId: role.id, grantOrganizationId: organization.id };
        }
      }
    }
  }
  const details: NonNullable<OrganizationLifecycleDto['deleteBlockerDetails']> = [];
  const reason = (code: string, count: number, message: string) => { if (count) details.push({ code, count, message }); };
  const role = roles.find(entry => entry.id === provenance?.roleId);
  const codes = role?.permissions.map(({ permission }) => permission.code).sort() ?? [];
  const permissionsValid = codes.includes('organization:read') && codes.includes('organization:manage')
    && codes.every(code => organizationGovernancePermissions.includes(code))
    && codes.join(',') === [...(provenance?.permissionCodes ?? [])].sort().join(',');
  const roleValid = Boolean(role && role.code === 'ORGANIZATION_GOVERNOR' && !role.mfaRequired && !role.positions.length && permissionsValid);
  reason('INITIALIZATION_PERMISSIONS_CHANGED', role && !permissionsValid ? 1 : 0, '初始化角色实际权限与精确来源快照不同；请核对真实授权。');
  reason('NON_INITIALIZATION_ROLES', roles.filter(entry => entry.id !== role?.id || !roleValid).length, '存在无法精确识别为初始化的角色、岗位映射或安全配置；不能按角色名自动清理。');
  const expectedGrant = (grant: { userId: string; roleId: string; organizationId: string }) => roleValid
    && grant.userId === provenance?.grantUserId && grant.roleId === provenance?.grantRoleId && grant.organizationId === provenance?.grantOrganizationId;
  const allGrants = new Map([...grants, ...roles.flatMap(entry => entry.userRoles)].map(grant => [`${grant.userId}:${grant.roleId}:${grant.organizationId}`, grant]));
  reason('NON_INITIALIZATION_GRANTS', [...allGrants.values()].filter(grant => !expectedGrant(grant)).length, '存在额外、跨组织或来源已失效的真实授权；撤销后重授不再属于原初始化授权。');
  // Missing historical evidence alone is not a dependency when no actual role/grant remains.
  return { blocked: details.length > 0, details, roleId: details.length === 0 && roleValid ? role!.id : undefined,
    creatorUserId: provenance?.creatorUserId, grantUserId: provenance?.grantUserId ?? undefined };
}
