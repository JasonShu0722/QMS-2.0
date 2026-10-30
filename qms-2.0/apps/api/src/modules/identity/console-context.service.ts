import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { adminError } from '../../common/security/admin-mutation.service.js';
import { effectiveRoleGrants } from '../../common/security/effective-role-grants.js';
import { ADMIN_PERMISSIONS, ADMINISTRATIVE_LIFECYCLE_PERMISSION_CODES, PLATFORM_INACTIVE_MANAGEMENT_PERMISSION_CODES } from '../authorization/permission-catalog.js';
import type { AuthorizedSessionUser } from '../authorization/authorization.service.js';
import type { ConsoleContextDto, ConsoleModuleDto, ConsoleOrganizationDto } from './dto/console-context.dto.js';

const masterMaintenance = ['material-master:write', 'material-master:import', 'component-project:manage', 'customer-quality:complaints:write', 'supplier-quality:profiles:write'];
const modulePermissions: Partial<Record<ConsoleModuleDto['key'], string[]>> = {
  users: [...ADMIN_PERMISSIONS.filter(code => code.startsWith('account:users:')), 'account:users:delete'],
  organizations: [...ADMIN_PERMISSIONS.filter(code => code.startsWith('organization:') || code.startsWith('account:roles:')), 'organization:read', 'organization:force-delete', 'organization:departments:force-delete'],
  'master-data': [...masterMaintenance, 'material-master:read', 'component-project:read', 'customer-quality:complaints:read', 'supplier-quality:profiles:read'],
  configuration: ['configuration:read', 'configuration:manage'],
  audit: ['audit:read', 'audit:export'],
  outbox: ['outbox:read', 'outbox:retry'],
};

const organizationSelect = { id: true, code: true, name: true, type: true, status: true, configurationRequired: true } as const;

function targetModules(permissions: string[], organization: Pick<ConsoleOrganizationDto, 'id' | 'status' | 'configurationRequired'>, platformAdministrator: boolean): ConsoleModuleDto[] {
  const usable = permissions.filter(code => (platformAdministrator || !ADMINISTRATIVE_LIFECYCLE_PERMISSION_CODES.includes(code))
    && (organization.status === 'ACTIVE' && !organization.configurationRequired
      || (platformAdministrator ? PLATFORM_INACTIVE_MANAGEMENT_PERMISSION_CODES.includes(code)
        : code === 'organization:manage' || code === 'organization:read' && permissions.includes('organization:manage'))));
  return Object.entries(modulePermissions).flatMap(([key, codes]) => {
    const granted = usable.filter(code => codes.includes(code));
    if (!granted.length || key === 'master-data' && !granted.some(code => masterMaintenance.includes(code))) return [];
    return [{ key: key as ConsoleModuleDto['key'], scope: 'TARGET' as const, coverage: 'ORGANIZATION' as const, organizationId: organization.id, permissions: granted }];
  });
}

@Injectable()
export class ConsoleContextService {
  constructor(private readonly prisma: PrismaService) {}

  async context(actor: AuthorizedSessionUser, organizationId?: string): Promise<ConsoleContextDto> {
    organizationId = organizationId?.toLowerCase();
    if (actor.accountType !== 'INTERNAL') adminError('FEATURE_PERMISSION_DENIED', 403);
    const current = await this.prisma.user.findUnique({ where: { id: actor.id }, select: {
      id: true, organizationId: true, accountType: true, status: true, deletedAt: true, configurationRequired: true,
      organization: { select: { ...organizationSelect, deletedAt: true } },
    } });
    if (!current || current.status !== 'ACTIVE' || current.deletedAt || current.configurationRequired
      || current.accountType !== 'INTERNAL' || current.organizationId !== actor.organizationId) adminError('AUTH_SESSION_REQUIRED', 401);
    if (current.organization.type !== 'INTERNAL' || current.organization.status !== 'ACTIVE'
      || current.organization.deletedAt || current.organization.configurationRequired) adminError('ORGANIZATION_DISABLED', 403);

    const grants = await effectiveRoleGrants(this.prisma, actor.id);
    const platformAdministrator = grants.some(grant => !!grant.platformScope);
    const permissions = new Map<string, string[]>();
    for (const grant of grants) permissions.set(grant.organizationId, [...new Set([
      ...(permissions.get(grant.organizationId) ?? []), ...grant.role.permissions.map(({ permission }) => permission.code),
    ])].sort());
    const homePermissions = permissions.get(actor.organizationId) ?? [];
    const workflow = homePermissions.includes('workflow:manage');
    const homeModules: ConsoleModuleDto[] = [
      ...(workflow ? [{ key: 'workflows' as const, scope: 'SESSION_HOME' as const, coverage: 'ORGANIZATION' as const, organizationId: actor.organizationId, permissions: ['workflow:manage'] }] : []),
      ...(platformAdministrator && ['account:users:read', 'account:users:delete'].every(code => homePermissions.includes(code))
        ? [{ key: 'supplier-accounts' as const, scope: 'SESSION_HOME' as const, coverage: 'PLATFORM' as const, organizationId: actor.organizationId, permissions: ['account:users:delete', 'account:users:read'] }] : []),
      ...(platformAdministrator && homePermissions.includes('organization:reconfigure')
        ? (['reconfiguration', 'problem-reconfiguration'] as const).map(key => ({ key, scope: 'SESSION_HOME' as const, coverage: 'PLATFORM' as const, organizationId: actor.organizationId, permissions: ['organization:reconfigure'] })) : []),
    ];
    // Check candidate capability scope before reading target names, even for unknown UUIDs.
    const candidates = [...permissions].filter(([id, codes]) => targetModules(codes, { id, status: 'ACTIVE', configurationRequired: false }, platformAdministrator).length
      || id === actor.organizationId && homeModules.length).map(([id]) => id);
    if (!candidates.length) adminError('FEATURE_PERMISSION_DENIED', 403);
    if (organizationId !== undefined && !candidates.includes(organizationId)) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    const organizations = (await this.prisma.organization.findMany({ where: { id: { in: candidates }, deletedAt: null }, select: organizationSelect }))
      .filter(organization => targetModules(permissions.get(organization.id) ?? [], organization, platformAdministrator).length
        || organization.id === actor.organizationId && homeModules.length)
      .sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
    const target = organizationId === undefined
      ? organizations.find(organization => organization.id === actor.organizationId) ?? organizations[0]
      : organizations.find(organization => organization.id === organizationId);
    if (!target) adminError(organizationId === undefined ? 'FEATURE_PERMISSION_DENIED' : 'ORGANIZATION_SCOPE_DENIED', 403);
    const { deletedAt: _deletedAt, ...homeOrganization } = current.organization;
    return {
      actor: { id: actor.id, accountType: 'INTERNAL', homeOrganization },
      targetOrganization: target,
      organizations,
      hasPlatformAdministrator: platformAdministrator,
      modules: [...targetModules(permissions.get(target.id) ?? [], target, platformAdministrator), ...homeModules],
    };
  }
}
