import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { OrganizationService } from './organization.service.js';
import { CreateDepartmentDto, CreateOrganizationDto, CreatePositionDto, DepartmentDto, OrganizationDto, OrganizationListQueryDto, PositionDto, ReplaceUserPositionsDto, UpdateDepartmentDto, UpdateOrganizationDto, UpdatePositionDto, UserPositionDto } from './organization.dto.js';

const scope = { source: 'params' as const, field: 'organizationId', optional: false };

@Controller('api/v1/organizations')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class OrganizationGovernanceController {
  constructor(private readonly organizations: OrganizationService) {}

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

  @Get(':organizationId/positions')
  @ApiOkResponse({ type: PositionDto, isArray: true })
  @RequireAccess({ featurePermission: 'organization:structure:read', organizationScope: scope })
  positions(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Query() query: OrganizationListQueryDto) {
    return this.organizations.positions(organizationId, query);
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
  replaceUserPositions(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: ReplaceUserPositionsDto, @Req() request: Request) {
    return this.organizations.replaceUserPositions(this.actor(request), organizationId, userId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  private actor(request: Request) {
    const authorized = request as AuthorizedRequest;
    return { ...authorized[AUTHENTICATED_SESSION]!.user, sessionId: authorized[AUTHENTICATED_SESSION]!.id, scopeOrganizationId: authorized.authorizedOrganizationId };
  }
}
