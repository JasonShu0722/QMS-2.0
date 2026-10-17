import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AdminUserService } from './admin-user.service.js';
import { userUpdatePermissions } from '../authorization/permission-catalog.js';
import { AdminMfaPolicyDto, AdminMfaPolicyInputDto, AdminUserDto, AdminUserListQueryDto, CreateAdminUserDto, ResetAdminUserPasswordDto, UpdateAdminUserDto, PasswordResetIssuedDto } from './dto/admin-user.dto.js';
import { clearSessionCookieOptions, SESSION_COOKIE } from './session.service.js';
import { ResetTemporaryPasswordDto, TemporaryPasswordDto } from './dto/password-change-challenge.dto.js';
import { AdminUserBatchService } from './admin-user-batch.service.js';
import { AdminUserBatchResultDto, CreateAdminUserBatchDto } from './dto/admin-user-batch.dto.js';

@Controller('api/v1/admin/users')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class AdminUserController {
  constructor(private readonly users: AdminUserService, private readonly batches: AdminUserBatchService) {}

  @Post('batch')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiCreatedResponse({ type: AdminUserBatchResultDto })
  @RequireAccess({ featurePermission: 'account:users:create', organizationScope: { source: 'body', field: 'organizationId', optional: false } })
  createBatch(@Body() dto: CreateAdminUserBatchDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.set('Cache-Control', 'no-store');
    return this.batches.create(this.actor(request), dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

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

  @Get(':userId/mfa-policy')
  @ApiOkResponse({ type: AdminMfaPolicyDto })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  @RequireAccess({ featurePermission: 'account:users:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  getMfaPolicy(@Param('userId', ParseUUIDPipe) userId: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.set('Cache-Control', 'no-store');
    return this.users.getMfaPolicy(this.actor(request), userId);
  }

  @Put(':userId/mfa-policy')
  @ApiOkResponse({ type: AdminMfaPolicyDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  @RequireAccess({ featurePermission: 'account:users:reset', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  async setMfaPolicy(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: AdminMfaPolicyInputDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.set('Cache-Control', 'no-store');
    const actor = this.actor(request);
    const result = await this.users.setMfaPolicy(actor, userId, dto, actor.scopeOrganizationId!, requestTraceId(request), request.get('Idempotency-Key'));
    if (result.selfSessionRevoked) response.clearCookie(SESSION_COOKIE, clearSessionCookieOptions());
    return result;
  }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiCreatedResponse({ type: AdminUserDto })
  @RequireAccess({ featurePermission: 'account:users:create', organizationScope: { source: 'body', field: 'organizationId', optional: false } })
  create(@Body() dto: CreateAdminUserDto, @Req() request: Request) {
    return this.users.create(this.actor(request), dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Patch(':userId')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: AdminUserDto })
  @RequireAccess({ featurePermission: 'account:users:update', featurePermissions: userUpdatePermissions, organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  update(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: UpdateAdminUserDto, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    return this.users.update(this.actor(request), userId, dto, authorized.authorizedOrganizationId!, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Post(':userId/password-reset')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: PasswordResetIssuedDto })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  @RequireAccess({ featurePermission: 'account:users:reset', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  resetPassword(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: ResetAdminUserPasswordDto, @Query('organizationId') organizationId: string | undefined, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    return this.users.resetPassword(this.actor(request), userId, dto.temporaryCode, organizationId ?? authorized.authorizedOrganizationId!, requestTraceId(request), request.get('Idempotency-Key'));
  }

  private actor(request: Request) {
    const authorized = request as AuthorizedRequest;
    const session = authorized[AUTHENTICATED_SESSION];
    if (!session) throw new Error('Authenticated session guard did not attach a session');
    return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
  }

  @Post(':userId/temporary-password/read')
  @ApiCreatedResponse({ type: TemporaryPasswordDto })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  @RequireAccess({ featurePermission: 'account:users:reset', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  readTemporaryPassword(@Param('userId', ParseUUIDPipe) userId: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.set('Cache-Control', 'no-store');
    const actor = this.actor(request);
    return this.users.readTemporaryPassword(actor, userId, actor.scopeOrganizationId!, requestTraceId(request));
  }

  @Post(':userId/temporary-password/reset')
  @ApiCreatedResponse({ type: TemporaryPasswordDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  @RequireAccess({ featurePermission: 'account:users:reset', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  resetTemporaryPassword(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: ResetTemporaryPasswordDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.set('Cache-Control', 'no-store');
    const actor = this.actor(request);
    return this.users.resetTemporaryPassword(actor, userId, dto.temporaryPassword, actor.scopeOrganizationId!, requestTraceId(request), request.get('Idempotency-Key'));
  }
}
