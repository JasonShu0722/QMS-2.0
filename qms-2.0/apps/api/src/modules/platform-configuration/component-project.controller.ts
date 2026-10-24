import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ComponentProjectService } from './component-project.service.js';
import {
  ComponentProjectScopeDto, ComponentProjectListQueryDto, ComponentEngineerAssignmentsQueryDto, ResolveComponentProjectQueryDto,
  CreateComponentProjectRecordDto, UpdateComponentProjectRecordDto, CreateComponentProjectMappingDto, UpdateComponentProjectMappingDto,
  ComponentProjectRecordDto, ComponentProjectMappingDto, ComponentProjectRecordsPageDto, ComponentProjectMappingsPageDto,
  ComponentEngineerAssignmentsPageDto, ComponentProjectResolutionDto,
  ComponentProjectImportDto, ComponentProjectImportResultDto,
} from './component-project.dto.js';

const readAccess = { featurePermission: 'component-project:read', organizationScope: { source: 'query' as const, field: 'organizationId', optional: true } };
const writeAccess = { ...readAccess, featurePermission: 'component-project:manage' };

@Controller('api/v1/admin/configuration')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class ComponentProjectController {
  constructor(private readonly service: ComponentProjectService) {}

  @Get('component-project-records') @RequireAccess(readAccess) @ApiOkResponse({ type: ComponentProjectRecordsPageDto })
  listProjects(@Query() query: ComponentProjectListQueryDto, @Req() request: AuthorizedRequest) {
    return this.service.listProjects(this.actor(request), request.authorizedOrganizationId!, query);
  }

  @Get('component-project-records/:id') @RequireAccess(readAccess) @ApiOkResponse({ type: ComponentProjectRecordDto })
  project(@Param('id', ParseUUIDPipe) id: string, @Query() _query: ComponentProjectScopeDto, @Req() request: AuthorizedRequest) {
    return this.service.getProject(this.actor(request), request.authorizedOrganizationId!, id);
  }

  @Post('component-project-records') @RequireAccess(writeAccess) @ApiCreatedResponse({ type: ComponentProjectRecordDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  createProject(@Query() _query: ComponentProjectScopeDto, @Body() dto: CreateComponentProjectRecordDto, @Req() request: AuthorizedRequest) {
    return this.service.createProject(this.actor(request), request.authorizedOrganizationId!, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Patch('component-project-records/:id') @RequireAccess(writeAccess) @ApiOkResponse({ type: ComponentProjectRecordDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  updateProject(@Param('id', ParseUUIDPipe) id: string, @Query() _query: ComponentProjectScopeDto, @Body() dto: UpdateComponentProjectRecordDto, @Req() request: AuthorizedRequest) {
    return this.service.updateProject(this.actor(request), request.authorizedOrganizationId!, id, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Get('component-project-mappings') @RequireAccess(readAccess) @ApiOkResponse({ type: ComponentProjectMappingsPageDto })
  listMappings(@Query() query: ComponentProjectListQueryDto, @Req() request: AuthorizedRequest) {
    return this.service.listMappings(this.actor(request), request.authorizedOrganizationId!, query);
  }

  @Post('component-project-mappings/import')
  @RequireAccess({ featurePermission: 'component-project:manage', organizationScope: { source: 'body', field: 'organizationId', optional: true } })
  @ApiCreatedResponse({ type: ComponentProjectImportResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  importComponents(@Body() dto: ComponentProjectImportDto, @Req() request: AuthorizedRequest) {
    return this.service.importComponents(this.actor(request), request.authorizedOrganizationId!, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Post('component-project-mappings') @RequireAccess(writeAccess) @ApiCreatedResponse({ type: ComponentProjectMappingDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  createMapping(@Query() _query: ComponentProjectScopeDto, @Body() dto: CreateComponentProjectMappingDto, @Req() request: AuthorizedRequest) {
    return this.service.createMapping(this.actor(request), request.authorizedOrganizationId!, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Patch('component-project-mappings/:id') @RequireAccess(writeAccess) @ApiOkResponse({ type: ComponentProjectMappingDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  updateMapping(@Param('id', ParseUUIDPipe) id: string, @Query() _query: ComponentProjectScopeDto, @Body() dto: UpdateComponentProjectMappingDto, @Req() request: AuthorizedRequest) {
    return this.service.updateMapping(this.actor(request), request.authorizedOrganizationId!, id, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Get('component-project-mappings/resolve') @RequireAccess(readAccess) @ApiOkResponse({ type: ComponentProjectResolutionDto })
  resolve(@Query() query: ResolveComponentProjectQueryDto, @Req() request: AuthorizedRequest) {
    return this.service.resolve(this.actor(request), request.authorizedOrganizationId!, query);
  }

  @Get('component-project-mappings/engineer-assignments') @RequireAccess(readAccess) @ApiOkResponse({ type: ComponentEngineerAssignmentsPageDto })
  engineerAssignments(@Query() query: ComponentEngineerAssignmentsQueryDto, @Req() request: AuthorizedRequest) {
    return this.service.engineerAssignments(this.actor(request), request.authorizedOrganizationId!, query);
  }

  private actor(request: AuthorizedRequest) {
    return { ...request[AUTHENTICATED_SESSION]!.user, sessionId: request[AUTHENTICATED_SESSION]!.id };
  }
}
