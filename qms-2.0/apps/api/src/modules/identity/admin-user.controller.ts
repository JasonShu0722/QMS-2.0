import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AdminUserService } from './admin-user.service.js';
import { AdminUserDto, AdminUserListQueryDto, CreateAdminUserDto, ResetAdminUserPasswordDto, UpdateAdminUserDto, PasswordResetIssuedDto } from './dto/admin-user.dto.js';

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
  detail(@Param('userId', ParseUUIDPipe) userId: string, @Query('organizationId') organizationId: string | undefined, @Req() request: Request) {
    return this.users.detail(this.actor(request), userId, organizationId);
  }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiCreatedResponse({ type: AdminUserDto })
  @RequireAccess({ featurePermission: 'account:users:manage', organizationScope: { source: 'body', field: 'organizationId', optional: false } })
  create(@Body() dto: CreateAdminUserDto, @Req() request: Request) {
    return this.users.create(this.actor(request), dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Patch(':userId')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: AdminUserDto })
  @RequireAccess({ featurePermission: 'account:users:manage', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  update(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: UpdateAdminUserDto, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    return this.users.update(this.actor(request), userId, dto, authorized.authorizedOrganizationId!, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Post(':userId/password-reset')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: PasswordResetIssuedDto })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  @RequireAccess({ featurePermission: 'account:users:manage', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  resetPassword(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: ResetAdminUserPasswordDto, @Query('organizationId') organizationId: string | undefined, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    return this.users.resetPassword(this.actor(request), userId, dto.temporaryCode, organizationId ?? authorized.authorizedOrganizationId!, requestTraceId(request), request.get('Idempotency-Key'));
  }

  private actor(request: Request) {
    const authorized = request as AuthorizedRequest;
    const session = authorized[AUTHENTICATED_SESSION];
    if (!session) throw new Error('Authenticated session guard did not attach a session');
    return { ...session.user, scopeOrganizationId: authorized.authorizedOrganizationId };
  }
}
