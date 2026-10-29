import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { adminError } from '../../common/security/admin-mutation.service.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { OrganizationForceDeleteDto, OrganizationForceDeletePreviewDto, OrganizationForceDeleteResultDto } from './organization-force-delete.dto.js';
import { OrganizationForceDeleteService } from './organization-force-delete.service.js';

@Controller('api/v1/organizations')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
@RequireAuthenticated()
export class OrganizationForceDeleteController {
  constructor(private readonly commands: OrganizationForceDeleteService) {}

  @Get(':organizationId/force-delete')
  @ApiOkResponse({ type: OrganizationForceDeletePreviewDto })
  previewOrganization(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Req() request: Request) {
    return this.commands.previewOrganization(this.actor(request), organizationId);
  }

  @Post(':organizationId/force-delete')
  @ApiCreatedResponse({ type: OrganizationForceDeleteResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  deleteOrganization(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Body() dto: OrganizationForceDeleteDto, @Req() request: Request) {
    return this.commands.forceDeleteOrganization(this.actor(request), organizationId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Get(':organizationId/departments/:departmentId/force-delete')
  @ApiOkResponse({ type: OrganizationForceDeletePreviewDto })
  previewDepartment(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('departmentId', ParseUUIDPipe) departmentId: string, @Req() request: Request) {
    return this.commands.previewDepartment(this.actor(request), organizationId, departmentId);
  }

  @Post(':organizationId/departments/:departmentId/force-delete')
  @ApiCreatedResponse({ type: OrganizationForceDeleteResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  deleteDepartment(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('departmentId', ParseUUIDPipe) departmentId: string, @Body() dto: OrganizationForceDeleteDto, @Req() request: Request) {
    return this.commands.forceDeleteDepartment(this.actor(request), organizationId, departmentId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  private actor(request: Request) {
    const session = (request as AuthorizedRequest)[AUTHENTICATED_SESSION];
    if (!session) adminError('AUTH_SESSION_REQUIRED', 401);
    return { id: session.user.id, organizationId: session.user.organizationId, accountType: session.user.accountType, sessionId: session.id };
  }
}
