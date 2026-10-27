import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { CustomerEightDService } from './customer-eight-d.service.js';
import { CustomerEightDIssueResultDto, IssueCustomerEightDDto, CustomerEightDActivationDto, CustomerEightDAnalysisCompleteDto, CustomerEightDAssignmentOptionsDto, CustomerEightDAssignmentOptionsQueryDto, CustomerEightDBindingDto, CustomerEightDBindingResultDto,
  CustomerEightDCollaboratorsDto, CustomerEightDDeadlinesDto, CustomerEightDReportDto, CustomerEightDRiskDto, CustomerEightDScopeDto,
  CustomerEightDSourcesDto, CustomerEightDSourcePreviewDto, CustomerEightDSourcePreviewInputDto, CustomerEightDVersionDto, ReassignCustomerEightDDto, SaveCustomerEightDDto } from './customer-eight-d.dto.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;

@Controller('api/v1/customer-quality/eight-d')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class CustomerEightDController {
  constructor(private readonly service: CustomerEightDService) {}

  @Get('binding') @ApiOkResponse({ schema: { nullable: true, allOf: [{ $ref: getSchemaPath(CustomerEightDBindingResultDto) }] } })
  @RequireAccess({ featurePermission: 'configuration:read', organizationScope: queryScope })
  async binding(@Req() request: Request, @Query() _query: CustomerEightDScopeDto, @Res() response: Response) {
    response.status(200).json(await this.service.binding(actor(request)));
  }

  @Put('binding') @ApiOkResponse({ type: CustomerEightDBindingResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'configuration:manage', organizationScope: bodyScope })
  bind(@Req() request: Request, @Body() body: CustomerEightDBindingDto, @Headers('idempotency-key') key: string) { return this.service.bind(actor(request), body, key, requestTraceId(request)); }

  @Put('activation') @ApiOkResponse({ type: CustomerEightDBindingResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'configuration:manage', organizationScope: bodyScope })
  activate(@Req() request: Request, @Body() body: CustomerEightDActivationDto, @Headers('idempotency-key') key: string) { return this.service.activate(actor(request), body, key, requestTraceId(request)); }

  @Post() @ApiCreatedResponse({ type: CustomerEightDIssueResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'customer-quality:issues:issue', organizationScope: bodyScope })
  issue(@Req() request: Request, @Body() body: IssueCustomerEightDDto, @Headers('idempotency-key') key: string) { return this.service.issue(actor(request), body, requestTraceId(request), key); }

  @Post('sources/preview') @HttpCode(200) @ApiOkResponse({ type: [CustomerEightDSourcePreviewDto] })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'customer-quality:complaints:read', organizationScope: bodyScope })
  previewSources(@Req() request: Request, @Body() body: CustomerEightDSourcePreviewInputDto) { return this.service.previewSources(actor(request), body); }

  @Get('assignment-options') @ApiOkResponse({ type: CustomerEightDAssignmentOptionsDto })
  @RequireAccess({ featurePermission: 'customer-quality:issues:read', organizationScope: queryScope })
  assignmentOptions(@Req() request: Request, @Query() query: CustomerEightDAssignmentOptionsQueryDto) { return this.service.assignmentOptions(actor(request), query); }

  @Get(':id') @ApiOkResponse({ type: CustomerEightDReportDto })
  @RequireAccess({ featurePermission: 'customer-quality:issues:read', organizationScope: queryScope })
  read(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: CustomerEightDScopeDto) { return this.service.read(actor(request), id); }

  @Put(':id') @ApiOkResponse({ type: CustomerEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'customer-quality:issues:work', organizationScope: bodyScope })
  save(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: SaveCustomerEightDDto, @Headers('idempotency-key') key: string) { return this.service.save(actor(request), id, body, requestTraceId(request), key); }

  @Post(':id/analysis-complete') @HttpCode(200) @ApiOkResponse({ type: CustomerEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'customer-quality:issues:work', organizationScope: bodyScope })
  analysis(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CustomerEightDAnalysisCompleteDto, @Headers('idempotency-key') key: string) { return this.service.analysisComplete(actor(request), id, body, requestTraceId(request), key); }

  @Post(':id/submit') @HttpCode(200) @ApiOkResponse({ type: CustomerEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'customer-quality:issues:work', organizationScope: bodyScope })
  submit(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CustomerEightDVersionDto, @Headers('idempotency-key') key: string) { return this.service.submit(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/collaborators') @ApiOkResponse({ type: CustomerEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'customer-quality:issues:work', organizationScope: bodyScope })
  collaborators(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CustomerEightDCollaboratorsDto, @Headers('idempotency-key') key: string) { return this.service.collaborators(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/reassign') @ApiOkResponse({ type: CustomerEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'customer-quality:issues:read', organizationScope: bodyScope })
  reassign(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReassignCustomerEightDDto, @Headers('idempotency-key') key: string) { return this.service.reassign(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/risk') @ApiOkResponse({ type: CustomerEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'customer-quality:issues:risk', organizationScope: bodyScope })
  risk(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CustomerEightDRiskDto, @Headers('idempotency-key') key: string) { return this.service.risk(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/sources') @ApiOkResponse({ type: CustomerEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'customer-quality:issues:sources', organizationScope: bodyScope })
  sources(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CustomerEightDSourcesDto, @Headers('idempotency-key') key: string) { return this.service.sources(actor(request), id, body, requestTraceId(request), key); }

  @Put(':id/deadlines') @ApiOkResponse({ type: CustomerEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'customer-quality:issues:deadlines', organizationScope: bodyScope })
  deadlines(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CustomerEightDDeadlinesDto, @Headers('idempotency-key') key: string) { return this.service.deadlines(actor(request), id, body, requestTraceId(request), key); }
}
