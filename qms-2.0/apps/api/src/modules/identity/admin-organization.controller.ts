import { Controller, Get, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../../database/prisma.service.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ADMIN_PERMISSIONS, adminError } from '../../common/security/admin-mutation.service.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { AdminOrganizationDto } from './dto/admin-user.dto.js';

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
    const assignments = await this.prisma.userRole.findMany({ where: { userId: actor.id, ...(actor.accountType === 'SUPPLIER' ? { organizationId: actor.organizationId } : {}) }, include: { organization: true, role: { include: { permissions: { include: { permission: true } } } } } });
    const result = new Map<string, AdminOrganizationDto>();
    for (const assignment of assignments) {
      const organization = assignment.organization;
      const entry = result.get(organization.id) ?? { id: organization.id, code: organization.code, name: organization.name, type: organization.type, permissions: [] };
      entry.permissions = [...new Set([...entry.permissions, ...assignment.role.permissions.map((item) => item.permission.code)])].sort();
      result.set(organization.id, entry);
    }
    return [...result.values()].filter((entry) => entry.permissions.some((code) => ADMIN_PERMISSIONS.includes(code))).sort((first, second) => first.code.localeCompare(second.code));
  }
}
