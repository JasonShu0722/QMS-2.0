import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AdminUserService } from './admin-user.service.js';
import { AdminUserDto, AdminUserListQueryDto, CreateAdminUserDto, ResetAdminUserPasswordDto, UpdateAdminUserDto } from './dto/admin-user.dto.js';

@Controller('api/v1/admin/users')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class AdminUserController {
  constructor(private readonly users: AdminUserService) {}

  @Get()
  @ApiOkResponse({ type: AdminUserDto, isArray: true })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  @RequireAccess({ featurePermission: 'account:users:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  list(@Query() query: AdminUserListQueryDto, @Req() request: Request) {
    return this.users.list(this.actor(request), query);
  }

  @Get(':userId')
  @ApiOkResponse({ type: AdminUserDto })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  @RequireAccess({ featurePermission: 'account:users:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  detail(@Param('userId') userId: string, @Query('organizationId') organizationId: string | undefined, @Req() request: Request) {
    return this.users.detail(this.actor(request), userId, organizationId);
  }

  @Post()
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: AdminUserDto })
  @RequireAccess({ featurePermission: 'account:users:manage', organizationScope: { source: 'body', field: 'organizationId', optional: false } })
  create(@Body() dto: CreateAdminUserDto, @Req() request: Request) {
    return this.users.create(this.actor(request), dto, requestTraceId(request));
  }

  @Patch(':userId')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: AdminUserDto })
  @RequireAccess({ featurePermission: 'account:users:manage', organizationScope: { source: 'body', field: 'organizationId', optional: true } })
  update(@Param('userId') userId: string, @Body() dto: UpdateAdminUserDto, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    return this.users.update(this.actor(request), userId, dto, authorized.authorizedOrganizationId!, requestTraceId(request));
  }

  @Post(':userId/password-reset')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  @RequireAccess({ featurePermission: 'account:users:manage', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  async resetPassword(@Param('userId') userId: string, @Body() dto: ResetAdminUserPasswordDto, @Query('organizationId') organizationId: string | undefined, @Req() request: Request): Promise<void> {
    const authorized = request as AuthorizedRequest;
    await this.users.resetPassword(this.actor(request), userId, dto.newPassword, organizationId ?? authorized.authorizedOrganizationId!, requestTraceId(request));
  }

  private actor(request: Request) {
    const authorized = request as AuthorizedRequest;
    const session = authorized[AUTHENTICATED_SESSION];
    if (!session) throw new Error('Authenticated session guard did not attach a session');
    return { ...session.user, scopeOrganizationId: authorized.authorizedOrganizationId };
  }
}
