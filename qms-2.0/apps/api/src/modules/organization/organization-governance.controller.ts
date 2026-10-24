import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AdminMutationService, adminError } from '../../common/security/admin-mutation.service.js';
import { RequireAccess, RequireAuthenticated } from '../authorization/access.decorator.js';
import { OrganizationService } from './organization.service.js';
import { CreateDepartmentDto, CreateOrganizationDto, CreatePositionDto, DeleteStructureDto, DeleteStructureResultDto, DepartmentDto, OrganizationDto, OrganizationLifecycleDto, OrganizationListQueryDto, PositionDto, PositionPermissionsDto, PositionRolesDto, ReplacePositionRolesDto, ReplaceUserPositionsWithPreviewDto, UpdateDepartmentDto, UpdateOrganizationDto, UpdatePositionDto, UpdatePositionPermissionsDto, UserPositionDto } from './organization.dto.js';

const scope = { source: 'params' as const, field: 'organizationId', optional: false };

@Controller('api/v1/organizations')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class OrganizationGovernanceController {
  constructor(private readonly organizations: OrganizationService, private readonly mutations: AdminMutationService) {}

  @Get('tree')
  @ApiOkResponse({ type: OrganizationDto, isArray: true })
  @RequireAccess({ featurePermission: 'organization:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  tree(@Query() query: OrganizationListQueryDto, @Req() request: Request) {
    return this.organizations.tree(this.actor(request), query);
  }

  @Post(':organizationId/children')
  @ApiCreatedResponse({ type: OrganizationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'organization:manage', organizationScope: scope })
  create(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Body() dto: CreateOrganizationDto, @Req() request: Request) {
    return this.organizations.createChild(this.actor(request), organizationId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Patch(':organizationId')
  @ApiOkResponse({ type: OrganizationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'organization:manage', organizationScope: scope })
  update(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Body() dto: UpdateOrganizationDto, @Req() request: Request) {
    return this.organizations.update(this.actor(request), organizationId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Get(':organizationId/lifecycle')
  @ApiOkResponse({ type: OrganizationLifecycleDto })
  @RequireAccess({ featurePermission: 'organization:manage', organizationScope: scope })
  lifecycle(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Req() request: Request) {
    return this.organizations.organizationLifecycle(this.actor(request), organizationId);
  }

  @Delete(':organizationId')
  @ApiOkResponse({ type: DeleteStructureResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAuthenticated()
  delete(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Body() dto: DeleteStructureDto, @Req() request: Request) {
    // The service authorizes target + frozen parent, including the target's post-delete receipt path.
    return this.organizations.deleteOrganization(this.actor(request), organizationId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Get(':organizationId/departments')
  @ApiOkResponse({ type: DepartmentDto, isArray: true })
  @RequireAccess({ featurePermission: 'organization:structure:read', organizationScope: scope })
  departments(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Query() query: OrganizationListQueryDto) {
    return this.organizations.departments(organizationId, query);
  }

  @Post(':organizationId/departments')
  @ApiCreatedResponse({ type: DepartmentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'organization:structure:manage', organizationScope: scope })
  createDepartment(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Body() dto: CreateDepartmentDto, @Req() request: Request) {
    return this.organizations.createDepartment(this.actor(request), organizationId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Patch(':organizationId/departments/:departmentId')
  @ApiOkResponse({ type: DepartmentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'organization:structure:manage', organizationScope: scope })
  updateDepartment(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('departmentId', ParseUUIDPipe) departmentId: string, @Body() dto: UpdateDepartmentDto, @Req() request: Request) {
    return this.organizations.updateDepartment(this.actor(request), organizationId, departmentId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Get(':organizationId/departments/:departmentId/lifecycle')
  @ApiOkResponse({ type: OrganizationLifecycleDto })
  @RequireAccess({ featurePermission: 'organization:structure:manage', organizationScope: scope })
  departmentLifecycle(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('departmentId', ParseUUIDPipe) departmentId: string, @Req() request: Request) {
    return this.organizations.departmentLifecycle(this.actor(request), organizationId, departmentId);
  }

  @Delete(':organizationId/departments/:departmentId')
  @ApiOkResponse({ type: DeleteStructureResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'organization:structure:manage', organizationScope: scope })
  deleteDepartment(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('departmentId', ParseUUIDPipe) departmentId: string, @Body() dto: DeleteStructureDto, @Req() request: Request) {
    return this.organizations.deleteDepartment(this.actor(request), organizationId, departmentId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Get(':organizationId/positions')
  @ApiOkResponse({ type: PositionDto, isArray: true })
  @RequireAccess({ featurePermission: 'organization:structure:read', organizationScope: scope })
  positions(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Query() query: OrganizationListQueryDto) {
    return this.organizations.positions(organizationId, query);
  }

  @Get(':organizationId/positions/:positionId/roles')
  @ApiOkResponse({ type: PositionRolesDto })
  @RequireAccess({ featurePermission: 'organization:structure:read', featurePermissions: () => ['organization:structure:read', 'account:roles:read'], organizationScope: scope })
  positionRoles(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('positionId', ParseUUIDPipe) positionId: string, @Req() request: Request) {
    return this.organizations.positionRoles(this.actor(request), organizationId, positionId);
  }

  @Put(':organizationId/positions/:positionId/roles')
  @ApiOperation({ deprecated: true, description: 'Legacy position role mappings are read-only; configure position permissions instead.' })
  @ApiForbiddenResponse({ type: ErrorResponse, description: 'Legacy position role mappings are read-only.' })
  @ApiOkResponse({ type: PositionRolesDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'organization:structure:manage', featurePermissions: () => ['organization:structure:manage', 'account:roles:read', 'account:roles:assign'], organizationScope: scope })
  replacePositionRoles(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('positionId', ParseUUIDPipe) positionId: string, @Body() dto: ReplacePositionRolesDto, @Req() request: Request) {
    return this.mutations.run<never>({ actor: this.actor(request), organizationId, key: request.get('Idempotency-Key'), action: 'LEGACY_POSITION_ROLES_HTTP_WRITE_REJECTED', payload: { positionId, dto }, permission: ['organization:structure:manage', 'account:roles:read', 'account:roles:assign'], traceId: requestTraceId(request) },
      async () => adminError('FEATURE_PERMISSION_DENIED', 403),
      async () => adminError('FEATURE_PERMISSION_DENIED', 403));
  }

  @Get(':organizationId/positions/:positionId/permissions')
  @ApiOkResponse({ type: PositionPermissionsDto })
  @RequireAccess({ featurePermission: 'organization:structure:read', featurePermissions: () => ['organization:structure:read', 'account:roles:read'], organizationScope: scope })
  positionPermissions(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('positionId', ParseUUIDPipe) positionId: string, @Req() request: Request) {
    return this.organizations.positionPermissions(this.actor(request), organizationId, positionId);
  }

  @Put(':organizationId/positions/:positionId/permissions')
  @ApiOkResponse({ type: PositionPermissionsDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'organization:structure:manage', featurePermissions: () => ['organization:structure:manage', 'account:roles:read', 'account:roles:update', 'account:roles:assign'], organizationScope: scope })
  updatePositionPermissions(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('positionId', ParseUUIDPipe) positionId: string, @Body() dto: UpdatePositionPermissionsDto, @Req() request: Request) {
    return this.organizations.updatePositionPermissions(this.actor(request), organizationId, positionId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Post(':organizationId/positions')
  @ApiCreatedResponse({ type: PositionDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'organization:structure:manage', organizationScope: scope })
  createPosition(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Body() dto: CreatePositionDto, @Req() request: Request) {
    return this.organizations.createPosition(this.actor(request), organizationId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Patch(':organizationId/positions/:positionId')
  @ApiOkResponse({ type: PositionDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'organization:structure:manage', organizationScope: scope })
  updatePosition(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('positionId', ParseUUIDPipe) positionId: string, @Body() dto: UpdatePositionDto, @Req() request: Request) {
    return this.organizations.updatePosition(this.actor(request), organizationId, positionId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Get(':organizationId/users/:userId/positions')
  @ApiOkResponse({ type: UserPositionDto, isArray: true })
  @RequireAccess({ featurePermission: 'organization:structure:read', organizationScope: scope })
  userPositions(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('userId', ParseUUIDPipe) userId: string, @Query() query: OrganizationListQueryDto) {
    return this.organizations.userPositions(organizationId, userId, query);
  }

  @Put(':organizationId/users/:userId/positions')
  @ApiOkResponse({ type: UserPositionDto, isArray: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'organization:positions:assign', organizationScope: scope })
  replaceUserPositions(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: ReplaceUserPositionsWithPreviewDto, @Req() request: Request) {
    return this.organizations.replaceUserPositions(this.actor(request), organizationId, userId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  private actor(request: Request) {
    const authorized = request as AuthorizedRequest;
    return { ...authorized[AUTHENTICATED_SESSION]!.user, sessionId: authorized[AUTHENTICATED_SESSION]!.id, scopeOrganizationId: authorized.authorizedOrganizationId };
  }
}
