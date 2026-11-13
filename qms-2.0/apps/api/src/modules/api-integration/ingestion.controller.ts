import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { IntegrationPageQueryDto, IntegrationScopeDto } from './integration-admin.dto.js';
import { DeleteIngestionRuleDto, IngestionControlDto, IngestionEndpointPageDto, IngestionHistoryPreviewInputDto, IngestionImportResultDto, IngestionItemActionDto, IngestionItemDetailDto, IngestionItemDto, IngestionItemPageDto, IngestionJobDto, IngestionJobPageDto, IngestionJobQueryDto, IngestionPreviewDto, IngestionPreviewInputDto, IngestionRuleDto, IngestionRulePageDto, SaveIngestionRuleDto, SubmitIngestionImportDto, UpdateIngestionRuleDto } from './ingestion.dto.js';
import { IngestionService } from './ingestion.service.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest, session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/admin/integrations/ingestion')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class IngestionController {
  constructor(private readonly service: IngestionService) {}

  @Get('endpoints') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IngestionEndpointPageDto })
  @RequireAccess({ featurePermission: 'ingestion:read', organizationScope: queryScope })
  endpoints(@Req() request: Request, @Query() query: IntegrationPageQueryDto) { return this.service.listEndpoints(actor(request), query); }

  @Get('rules') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IngestionRulePageDto })
  @RequireAccess({ featurePermission: 'ingestion:read', organizationScope: queryScope })
  rules(@Req() request: Request, @Query() query: IntegrationPageQueryDto) { return this.service.listRules(actor(request), query); }

  @Post('rules') @Header('Cache-Control', 'no-store') @ApiCreatedResponse({ type: IngestionRuleDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'ingestion:manage', organizationScope: bodyScope })
  createRule(@Req() request: Request, @Body() input: SaveIngestionRuleDto) { return this.service.saveRule(actor(request), input, requestTraceId(request), request.get('Idempotency-Key')); }

  @Patch('rules/:id') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IngestionRuleDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'ingestion:manage', organizationScope: bodyScope })
  updateRule(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateIngestionRuleDto) { return this.service.saveRule(actor(request), input, requestTraceId(request), request.get('Idempotency-Key'), id); }

  @Delete('rules/:id') @HttpCode(204) @Header('Cache-Control', 'no-store') @ApiNoContentResponse() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'ingestion:manage', organizationScope: bodyScope })
  deleteRule(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: DeleteIngestionRuleDto) { return this.service.deleteRule(actor(request), id, input, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('preview') @Header('Cache-Control', 'no-store') @ApiCreatedResponse({ type: IngestionPreviewDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'ingestion:run', organizationScope: bodyScope })
  preview(@Req() request: Request, @Body() input: IngestionPreviewInputDto) { return this.service.preview(actor(request), input, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('imports/preview') @Header('Cache-Control', 'no-store') @ApiCreatedResponse({ type: IngestionPreviewDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'ingestion:run', organizationScope: bodyScope })
  previewHistory(@Req() request: Request, @Body() input: IngestionHistoryPreviewInputDto) { return this.service.previewHistory(actor(request), input, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('imports') @Header('Cache-Control', 'no-store') @ApiCreatedResponse({ type: IngestionImportResultDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'ingestion:run', organizationScope: bodyScope })
  submit(@Req() request: Request, @Body() input: SubmitIngestionImportDto) { return this.service.submitImport(actor(request), input, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get('jobs') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IngestionJobPageDto })
  @RequireAccess({ featurePermission: 'ingestion:read', organizationScope: queryScope })
  jobs(@Req() request: Request, @Query() query: IngestionJobQueryDto) { return this.service.listJobs(actor(request), query); }

  @Get('jobs/:id') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IngestionJobDto })
  @RequireAccess({ featurePermission: 'ingestion:read', organizationScope: queryScope })
  job(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: IntegrationScopeDto) { return this.service.getJob(actor(request), id); }

  @Get('jobs/:id/items') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IngestionItemPageDto })
  @RequireAccess({ featurePermission: 'ingestion:read', organizationScope: queryScope })
  items(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() query: IntegrationPageQueryDto) { return this.service.listItems(actor(request), id, query); }

  @Post('jobs/:id/control') @Header('Cache-Control', 'no-store') @ApiCreatedResponse({ type: IngestionJobDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'ingestion:run', organizationScope: bodyScope })
  control(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: IngestionControlDto) { return this.service.controlJob(actor(request), id, input, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get('items/:id') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IngestionItemDetailDto })
  @RequireAccess({ featurePermission: 'ingestion:read', organizationScope: queryScope })
  item(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: IntegrationScopeDto) { return this.service.getItem(actor(request), id, requestTraceId(request)); }

  @Post('items/:id/confirm') @Header('Cache-Control', 'no-store') @ApiCreatedResponse({ type: IngestionItemDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'ingestion:run', organizationScope: bodyScope })
  confirm(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: IngestionItemActionDto) { return this.service.actOnItem(actor(request), id, input, true, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('items/:id/skip') @Header('Cache-Control', 'no-store') @ApiCreatedResponse({ type: IngestionItemDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'ingestion:run', organizationScope: bodyScope })
  skip(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: IngestionItemActionDto) { return this.service.actOnItem(actor(request), id, input, false, requestTraceId(request), request.get('Idempotency-Key')); }
}
