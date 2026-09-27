import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { AuditManagementService } from '../audit-management/audit-management.service.js';
import { AuditScopeDto, AuditTemplateResponseDto, PublishedAuditTemplateResponseDto, PublishAuditTemplateDto } from '../audit-management/audit-management.dto.js';
import { AuditStandardDetailDto, AuditStandardPageDto, AuditStandardQueryDto, CreateAuditStandardDto, UpdateAuditStandardDto } from './audit-standards.dto.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}

const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/audit-standards')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class AuditStandardsController {
  constructor(private readonly service: AuditManagementService) {}

  @Get('templates')
  @ApiOkResponse({ type: AuditStandardPageDto })
  @RequireAccess({ featurePermission: 'audit-management:read', organizationScope: queryScope })
  list(@Req() request: Request, @Query() query: AuditStandardQueryDto) {
    return this.service.listTemplates(actor(request), query);
  }

  @Get('templates/:id')
  @ApiOkResponse({ type: AuditStandardDetailDto })
  @RequireAccess({ featurePermission: 'audit-management:read', organizationScope: queryScope })
  detail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: AuditScopeDto) {
    return this.service.getTemplateCatalogDetail(actor(request), id);
  }

  @Post('templates')
  @ApiCreatedResponse({ type: AuditTemplateResponseDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'audit-management:write', organizationScope: bodyScope })
  create(@Req() request: Request, @Body() input: CreateAuditStandardDto) {
    return this.service.createTemplate(actor(request), { name: input.name, auditType: input.auditType, definition: { items: input.definition.items } }, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Put('templates/:id')
  @ApiOkResponse({ type: AuditTemplateResponseDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'audit-management:write', organizationScope: bodyScope })
  updateDraft(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateAuditStandardDto) {
    return this.service.updateTemplate(actor(request), id, { expectedVersion: input.expectedVersion, definition: { items: input.definition.items } }, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Post('templates/:id/revisions')
  @ApiCreatedResponse({ type: AuditTemplateResponseDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'audit-management:write', organizationScope: bodyScope })
  revise(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateAuditStandardDto) {
    return this.service.reviseTemplate(actor(request), id, { expectedVersion: input.expectedVersion, definition: { items: input.definition.items } }, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Post('templates/:id/publish')
  @ApiCreatedResponse({ type: PublishedAuditTemplateResponseDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'audit-management:write', organizationScope: bodyScope })
  publish(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: PublishAuditTemplateDto) {
    return this.service.publishTemplate(actor(request), id, input.expectedVersion, requestTraceId(request), request.get('Idempotency-Key'));
  }
}
