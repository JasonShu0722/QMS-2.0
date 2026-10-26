import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ProcessIssueResultDto } from './process-quality.dto.js';
import { ProcessEightDService } from './process-eight-d.service.js';
import { IssueProcessEightDDto, ProcessEightDActivationDto, ProcessEightDAnalysisCompleteDto, ProcessEightDAssignmentOptionsDto, ProcessEightDAssignmentOptionsQueryDto, ProcessEightDBindingDto, ProcessEightDBindingResultDto,
  ProcessEightDCollaboratorsDto, ProcessEightDDeadlinesDto, ProcessEightDReportDto, ProcessEightDRiskDto, ProcessEightDScopeDto,
  ProcessEightDSourcesDto, ProcessEightDSourcePreviewDto, ProcessEightDSourcePreviewInputDto, ProcessEightDVersionDto, ReassignProcessEightDDto, SaveProcessEightDDto } from './process-eight-d.dto.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;

@Controller('api/v1/process-quality/eight-d')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class ProcessEightDController {
  constructor(private readonly service: ProcessEightDService) {}

  @Get('binding') @ApiOkResponse({ schema: { nullable: true, allOf: [{ $ref: getSchemaPath(ProcessEightDBindingResultDto) }] } })
  @RequireAccess({ featurePermission: 'configuration:read', organizationScope: queryScope })
  async binding(@Req() request: Request, @Query() _query: ProcessEightDScopeDto, @Res() response: Response) {
    response.status(200).json(await this.service.binding(actor(request)));
  }

  @Put('binding') @ApiOkResponse({ type: ProcessEightDBindingResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'configuration:manage', organizationScope: bodyScope })
  bind(@Req() request: Request, @Body() body: ProcessEightDBindingDto, @Headers('idempotency-key') key: string) { return this.service.bind(actor(request), body, key, requestTraceId(request)); }

  @Put('activation') @ApiOkResponse({ type: ProcessEightDBindingResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'configuration:manage', organizationScope: bodyScope })
  activate(@Req() request: Request, @Body() body: ProcessEightDActivationDto, @Headers('idempotency-key') key: string) { return this.service.activate(actor(request), body, key, requestTraceId(request)); }

  @Post() @ApiCreatedResponse({ type: ProcessIssueResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:issues:issue', organizationScope: bodyScope })
  issue(@Req() request: Request, @Body() body: IssueProcessEightDDto, @Headers('idempotency-key') key: string) { return this.service.issue(actor(request), body, requestTraceId(request), key); }

  @Post('sources/preview') @HttpCode(200) @ApiOkResponse({ type: [ProcessEightDSourcePreviewDto] })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:defects:read', organizationScope: bodyScope })
  previewSources(@Req() request: Request, @Body() body: ProcessEightDSourcePreviewInputDto) { return this.service.previewSources(actor(request), body); }

  @Get('assignment-options') @ApiOkResponse({ type: ProcessEightDAssignmentOptionsDto })
  @RequireAccess({ featurePermission: 'process-quality:issues:read', organizationScope: queryScope })
  assignmentOptions(@Req() request: Request, @Query() query: ProcessEightDAssignmentOptionsQueryDto) { return this.service.assignmentOptions(actor(request), query); }

  @Get(':id') @ApiOkResponse({ type: ProcessEightDReportDto })
  @RequireAccess({ featurePermission: 'process-quality:issues:read', organizationScope: queryScope })
  read(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: ProcessEightDScopeDto) { return this.service.read(actor(request), id); }

  @Put(':id') @ApiOkResponse({ type: ProcessEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:issues:work', organizationScope: bodyScope })
  save(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: SaveProcessEightDDto, @Headers('idempotency-key') key: string) { return this.service.save(actor(request), id, body, requestTraceId(request), key); }

  @Post(':id/analysis-complete') @HttpCode(200) @ApiOkResponse({ type: ProcessEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:issues:work', organizationScope: bodyScope })
  analysis(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ProcessEightDAnalysisCompleteDto, @Headers('idempotency-key') key: string) { return this.service.analysisComplete(actor(request), id, body, requestTraceId(request), key); }

  @Post(':id/submit') @HttpCode(200) @ApiOkResponse({ type: ProcessEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:issues:work', organizationScope: bodyScope })
  submit(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ProcessEightDVersionDto, @Headers('idempotency-key') key: string) { return this.service.submit(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/collaborators') @ApiOkResponse({ type: ProcessEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:issues:work', organizationScope: bodyScope })
  collaborators(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ProcessEightDCollaboratorsDto, @Headers('idempotency-key') key: string) { return this.service.collaborators(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/reassign') @ApiOkResponse({ type: ProcessEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:issues:read', organizationScope: bodyScope })
  reassign(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReassignProcessEightDDto, @Headers('idempotency-key') key: string) { return this.service.reassign(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/risk') @ApiOkResponse({ type: ProcessEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:issues:risk', organizationScope: bodyScope })
  risk(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ProcessEightDRiskDto, @Headers('idempotency-key') key: string) { return this.service.risk(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/sources') @ApiOkResponse({ type: ProcessEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:issues:sources', organizationScope: bodyScope })
  sources(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ProcessEightDSourcesDto, @Headers('idempotency-key') key: string) { return this.service.sources(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/deadlines') @ApiOkResponse({ type: ProcessEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:issues:deadlines', organizationScope: bodyScope })
  deadlines(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ProcessEightDDeadlinesDto, @Headers('idempotency-key') key: string) { return this.service.deadlines(actor(request), id, body, requestTraceId(request), key); }
}
