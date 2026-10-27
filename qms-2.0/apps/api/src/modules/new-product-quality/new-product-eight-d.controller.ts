import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { NewProductEightDService } from './new-product-eight-d.service.js';
import { NewProductEightDIssueResultDto, IssueNewProductEightDDto, NewProductEightDActivationDto, NewProductEightDAnalysisCompleteDto, NewProductEightDAssignmentOptionsDto, NewProductEightDAssignmentOptionsQueryDto, NewProductEightDBindingDto, NewProductEightDBindingResultDto,
  NewProductEightDCollaboratorsDto, NewProductEightDDeadlinesDto, NewProductEightDReportDto, NewProductEightDRiskDto, NewProductEightDScopeDto,
  NewProductEightDSourcesDto, NewProductEightDSourcePreviewDto, NewProductEightDSourcePreviewInputDto, NewProductEightDVersionDto, ReassignNewProductEightDDto, SaveNewProductEightDDto } from './new-product-eight-d.dto.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;

@Controller('api/v1/new-product-quality/eight-d')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class NewProductEightDController {
  constructor(private readonly service: NewProductEightDService) {}

  @Get('binding') @ApiOkResponse({ schema: { nullable: true, allOf: [{ $ref: getSchemaPath(NewProductEightDBindingResultDto) }] } })
  @RequireAccess({ featurePermission: 'configuration:read', organizationScope: queryScope })
  async binding(@Req() request: Request, @Query() _query: NewProductEightDScopeDto, @Res() response: Response) {
    response.status(200).json(await this.service.binding(actor(request)));
  }

  @Put('binding') @ApiOkResponse({ type: NewProductEightDBindingResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'configuration:manage', organizationScope: bodyScope })
  bind(@Req() request: Request, @Body() body: NewProductEightDBindingDto, @Headers('idempotency-key') key: string) { return this.service.bind(actor(request), body, key, requestTraceId(request)); }

  @Put('activation') @ApiOkResponse({ type: NewProductEightDBindingResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'configuration:manage', organizationScope: bodyScope })
  activate(@Req() request: Request, @Body() body: NewProductEightDActivationDto, @Headers('idempotency-key') key: string) { return this.service.activate(actor(request), body, key, requestTraceId(request)); }

  @Post() @ApiCreatedResponse({ type: NewProductEightDIssueResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'new-product-quality:issues:issue', organizationScope: bodyScope })
  issue(@Req() request: Request, @Body() body: IssueNewProductEightDDto, @Headers('idempotency-key') key: string) { return this.service.issue(actor(request), body, requestTraceId(request), key); }

  @Post('sources/preview') @HttpCode(200) @ApiOkResponse({ type: [NewProductEightDSourcePreviewDto] })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'new-product-quality:projects:read', organizationScope: bodyScope })
  previewSources(@Req() request: Request, @Body() body: NewProductEightDSourcePreviewInputDto) { return this.service.previewSources(actor(request), body); }

  @Get('assignment-options') @ApiOkResponse({ type: NewProductEightDAssignmentOptionsDto })
  @RequireAccess({ featurePermission: 'new-product-quality:issues:read', organizationScope: queryScope })
  assignmentOptions(@Req() request: Request, @Query() query: NewProductEightDAssignmentOptionsQueryDto) { return this.service.assignmentOptions(actor(request), query); }

  @Get(':id') @ApiOkResponse({ type: NewProductEightDReportDto })
  @RequireAccess({ featurePermission: 'new-product-quality:issues:read', organizationScope: queryScope })
  read(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: NewProductEightDScopeDto) { return this.service.read(actor(request), id); }

  @Put(':id') @ApiOkResponse({ type: NewProductEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'new-product-quality:issues:work', organizationScope: bodyScope })
  save(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: SaveNewProductEightDDto, @Headers('idempotency-key') key: string) { return this.service.save(actor(request), id, body, requestTraceId(request), key); }

  @Post(':id/analysis-complete') @HttpCode(200) @ApiOkResponse({ type: NewProductEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'new-product-quality:issues:work', organizationScope: bodyScope })
  analysis(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: NewProductEightDAnalysisCompleteDto, @Headers('idempotency-key') key: string) { return this.service.analysisComplete(actor(request), id, body, requestTraceId(request), key); }

  @Post(':id/submit') @HttpCode(200) @ApiOkResponse({ type: NewProductEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'new-product-quality:issues:work', organizationScope: bodyScope })
  submit(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: NewProductEightDVersionDto, @Headers('idempotency-key') key: string) { return this.service.submit(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/collaborators') @ApiOkResponse({ type: NewProductEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'new-product-quality:issues:work', organizationScope: bodyScope })
  collaborators(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: NewProductEightDCollaboratorsDto, @Headers('idempotency-key') key: string) { return this.service.collaborators(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/reassign') @ApiOkResponse({ type: NewProductEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'new-product-quality:issues:read', organizationScope: bodyScope })
  reassign(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReassignNewProductEightDDto, @Headers('idempotency-key') key: string) { return this.service.reassign(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/risk') @ApiOkResponse({ type: NewProductEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'new-product-quality:issues:risk', organizationScope: bodyScope })
  risk(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: NewProductEightDRiskDto, @Headers('idempotency-key') key: string) { return this.service.risk(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/sources') @ApiOkResponse({ type: NewProductEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'new-product-quality:issues:sources', organizationScope: bodyScope })
  sources(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: NewProductEightDSourcesDto, @Headers('idempotency-key') key: string) { return this.service.sources(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/deadlines') @ApiOkResponse({ type: NewProductEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'new-product-quality:issues:deadlines', organizationScope: bodyScope })
  deadlines(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: NewProductEightDDeadlinesDto, @Headers('idempotency-key') key: string) { return this.service.deadlines(actor(request), id, body, requestTraceId(request), key); }
}
