import { Controller, Get, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../../database/prisma.service.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { adminError } from '../../common/security/admin-mutation.service.js';
import { ADMIN_PERMISSIONS } from '../authorization/permission-catalog.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { AdminOrganizationDto } from './dto/admin-user.dto.js';
import { effectiveRoleGrants } from '../../common/security/effective-role-grants.js';

@Controller('api/v1/admin/organizations')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class AdminOrganizationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireAuthenticated()
  @ApiOkResponse({ type: AdminOrganizationDto, isArray: true })
  async list(@Req() request: AuthorizedRequest): Promise<AdminOrganizationDto[]> {
    const actor = request[AUTHENTICATED_SESSION]?.user;
    if (!actor) adminError('AUTH_SESSION_REQUIRED', 401);
    const assignments = await effectiveRoleGrants(this.prisma, actor.id, actor.accountType === 'SUPPLIER' ? actor.organizationId : undefined);
    const organizations = await this.prisma.organization.findMany({ where: { id: { in: [...new Set(assignments.map(({ organizationId }) => organizationId))] } }, select: { id: true, code: true, name: true, type: true } });
    const result = new Map<string, AdminOrganizationDto>();
    for (const assignment of assignments) {
      const organization = organizations.find(({ id }) => id === assignment.organizationId);
      if (!organization) continue;
      const entry = result.get(organization.id) ?? { id: organization.id, code: organization.code, name: organization.name, type: organization.type, permissions: [] };
      entry.permissions = [...new Set([...entry.permissions, ...assignment.role.permissions.map((item) => item.permission.code)])].sort();
      result.set(organization.id, entry);
    }
    return [...result.values()].filter((entry) => entry.permissions.some((code) => ADMIN_PERMISSIONS.includes(code)) || (actor.accountType === 'INTERNAL' && entry.type === 'INTERNAL' && entry.permissions.some((code) => ['organization:read', 'component-project:read', 'component-project:manage', 'customer-quality:complaints:read', 'material-master:read', 'material-master:write', 'material-master:import', 'supplier-quality:profiles:read', 'supplier-quality:profiles:write'].includes(code)))).sort((first, second) => first.code.localeCompare(second.code));
  }
}
