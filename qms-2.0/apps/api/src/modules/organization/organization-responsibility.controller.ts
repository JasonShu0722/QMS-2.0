import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import {
  CreateManagementBindingDto, CreateMinisterScopeDto, ManagementBindingDto,
  ManagementConfigurationQueryDto, ManagementResponsibilitiesDto, ManagementResponsibilitiesQueryDto,
  MinisterScopeDto, ResponsibilityAssignmentsDto, ResponsibilityAssignmentsQueryDto,
  UpdateManagementBindingDto, UpdateMinisterScopeDto,
} from './organization-responsibility.dto.js';
import { OrganizationResponsibilityService } from './organization-responsibility.service.js';

const scope = { source: 'params' as const, field: 'organizationId', optional: false };

@Controller('api/v1/organizations/:organizationId')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class OrganizationResponsibilityController {
  constructor(private readonly responsibilities: OrganizationResponsibilityService) {}

  @Get('management-bindings')
  @ApiOkResponse({ type: ManagementBindingDto, isArray: true })
  @RequireAccess({ featurePermission: 'organization:structure:read', organizationScope: scope })
  listManagementBindings(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Query() query: ManagementConfigurationQueryDto) {
    return this.responsibilities.listManagementBindings(organizationId, query);
  }

  @Post('management-bindings')
  @ApiCreatedResponse({ type: ManagementBindingDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'organization:structure:manage', organizationScope: scope })
  createManagementBinding(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Body() dto: CreateManagementBindingDto, @Req() request: Request) {
    return this.responsibilities.createManagementBinding(this.actor(request), organizationId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Patch('management-bindings/:bindingId')
  @ApiOkResponse({ type: ManagementBindingDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'organization:structure:manage', organizationScope: scope })
  updateManagementBinding(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('bindingId', ParseUUIDPipe) bindingId: string, @Body() dto: UpdateManagementBindingDto, @Req() request: Request) {
    return this.responsibilities.updateManagementBinding(this.actor(request), organizationId, bindingId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Get('minister-scopes')
  @ApiOkResponse({ type: MinisterScopeDto, isArray: true })
  @RequireAccess({ featurePermission: 'organization:structure:read', organizationScope: scope })
  listMinisterScopes(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Query() query: ManagementConfigurationQueryDto) {
    return this.responsibilities.listMinisterScopes(organizationId, query);
  }

  @Post('minister-scopes')
  @ApiCreatedResponse({ type: MinisterScopeDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'organization:structure:manage', organizationScope: scope })
  createMinisterScope(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Body() dto: CreateMinisterScopeDto, @Req() request: Request) {
    return this.responsibilities.createMinisterScope(this.actor(request), organizationId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Patch('minister-scopes/:scopeId')
  @ApiOkResponse({ type: MinisterScopeDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'organization:structure:manage', organizationScope: scope })
  updateMinisterScope(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('scopeId', ParseUUIDPipe) scopeId: string, @Body() dto: UpdateMinisterScopeDto, @Req() request: Request) {
    return this.responsibilities.updateMinisterScope(this.actor(request), organizationId, scopeId, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Get('management-responsibilities')
  @ApiOkResponse({ type: ManagementResponsibilitiesDto })
  @RequireAccess({ featurePermission: 'organization:structure:read', organizationScope: scope })
  managementResponsibilities(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Query() query: ManagementResponsibilitiesQueryDto) {
    return this.responsibilities.managementResponsibilities(organizationId, query.sectionDepartmentId);
  }

  @Get('responsibility-assignments')
  @ApiOkResponse({ type: ResponsibilityAssignmentsDto })
  @RequireAccess({ featurePermission: 'organization:structure:read', organizationScope: scope })
  responsibilityAssignments(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Query() query: ResponsibilityAssignmentsQueryDto) {
    return this.responsibilities.responsibilityAssignments(organizationId, query);
  }

  private actor(request: Request) {
    const authorized = request as AuthorizedRequest;
    return { ...authorized[AUTHENTICATED_SESSION]!.user, sessionId: authorized[AUTHENTICATED_SESSION]!.id, scopeOrganizationId: authorized.authorizedOrganizationId };
  }
}
