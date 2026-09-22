import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from './access.decorator.js';
import { AdminPermissionDto, AdminRoleDto, AdminRoleScopeQueryDto, AdminUserRolesDto, AssignAdminRolesDto, CopyAdminRoleDto, CreateAdminRoleDto, UpdateAdminRoleDto } from './admin-role.dto.js';
import { AdminRoleService } from './admin-role.service.js';
import { PermissionCatalogGroupDto } from './admin-role.dto.js';

@Controller('api/v1/admin')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class AdminRoleController {
  constructor(private readonly roles: AdminRoleService) {}

  @Get('permission-catalog')
  @ApiOkResponse({ type: PermissionCatalogGroupDto, isArray: true })
  @RequireAccess({ featurePermission: 'account:roles:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  catalog(@Query() _query: AdminRoleScopeQueryDto, @Req() request: Request) {
    return this.roles.catalog(this.actor(request));
  }

  @Get('permissions')
  @ApiOkResponse({ type: AdminPermissionDto, isArray: true })
  @RequireAccess({ featurePermission: 'account:roles:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  permissions(@Query() _query: AdminRoleScopeQueryDto, @Req() request: Request) {
    return this.roles.permissions(this.actor(request));
  }

  @Get('roles')
  @ApiOkResponse({ type: AdminRoleDto, isArray: true })
  @RequireAccess({ featurePermission: 'account:roles:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  list(@Query() _query: AdminRoleScopeQueryDto, @Req() request: Request) {
    return this.roles.list(this.actor(request));
  }

  @Get('roles/:roleId')
  @ApiOkResponse({ type: AdminRoleDto })
  @RequireAccess({ featurePermission: 'account:roles:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  detail(@Param('roleId', ParseUUIDPipe) roleId: string, @Query() _query: AdminRoleScopeQueryDto, @Req() request: Request) {
    return this.roles.detail(this.actor(request), roleId);
  }

  @Post('roles')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiCreatedResponse({ type: AdminRoleDto })
  @RequireAccess({ featurePermission: 'account:roles:create', organizationScope: { source: 'body', field: 'organizationId', optional: false } })
  create(@Body() dto: CreateAdminRoleDto, @Req() request: Request) {
    return this.roles.create(this.actor(request), dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Post('roles/:roleId/copy')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiCreatedResponse({ type: AdminRoleDto })
  @RequireAccess({ featurePermission: 'account:roles:create', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  copy(@Param('roleId', ParseUUIDPipe) roleId: string, @Query() _query: AdminRoleScopeQueryDto, @Body() dto: CopyAdminRoleDto, @Req() request: Request) {
    return this.roles.copy(this.actor(request), roleId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Patch('roles/:roleId')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: AdminRoleDto })
  @RequireAccess({ featurePermission: 'account:roles:update', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  update(@Param('roleId', ParseUUIDPipe) roleId: string, @Query() _query: AdminRoleScopeQueryDto, @Body() dto: UpdateAdminRoleDto, @Req() request: Request) {
    return this.roles.update(this.actor(request), roleId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Delete('roles/:roleId')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @HttpCode(204)
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiNoContentResponse()
  @RequireAccess({ featurePermission: 'account:roles:delete', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  remove(@Param('roleId', ParseUUIDPipe) roleId: string, @Query() _query: AdminRoleScopeQueryDto, @Req() request: Request) {
    return this.roles.remove(this.actor(request), roleId, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Get('users/:userId/roles')
  @ApiOkResponse({ type: AdminUserRolesDto })
  @RequireAccess({ featurePermission: 'account:roles:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  assignments(@Param('userId', ParseUUIDPipe) userId: string, @Query() _query: AdminRoleScopeQueryDto, @Req() request: Request) {
    return this.roles.assignments(this.actor(request), userId);
  }

  @Put('users/:userId/roles')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: AdminUserRolesDto })
  @RequireAccess({ featurePermission: 'account:roles:assign', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  assign(@Param('userId', ParseUUIDPipe) userId: string, @Query() _query: AdminRoleScopeQueryDto, @Body() dto: AssignAdminRolesDto, @Req() request: Request) {
    return this.roles.assign(this.actor(request), userId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  private actor(request: Request) {
    const authorized = request as AuthorizedRequest;
    const session = authorized[AUTHENTICATED_SESSION];
    if (!session) throw new Error('Authenticated session guard did not attach a session');
    return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
  }
}
