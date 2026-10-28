import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { IssueSupplierEightDDto, SaveSupplierEightDDto, SupplierEightDAnalysisCompleteDto, SupplierEightDDeadlinesDto, SupplierEightDReportDto, SupplierEightDVersionDto } from './supplier-eight-d.dto.js';
import { SupplierEightDService } from './supplier-eight-d.service.js';

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: request.authorizedOrganizationId };
}

@Controller('api/v1/supplier-quality/eight-d')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierEightDController {
  constructor(private readonly service: SupplierEightDService) {}

  @Post('drafts/:id/issue') @ApiCreatedResponse({ type: SupplierEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:issues:issue', organizationScope: { source: 'session', optional: true } })
  issue(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: IssueSupplierEightDDto, @Headers('idempotency-key') key: string) {
    return this.service.issueDraft(actor(request), id, body, requestTraceId(request), key);
  }

  @Get(':id') @ApiOkResponse({ type: SupplierEightDReportDto })
  @RequireAccess({ featurePermission: 'supplier-quality:issues:read', organizationScope: { source: 'session', optional: true } })
  read(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.read(actor(request), id); }

  @Put(':id') @ApiOkResponse({ type: SupplierEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:issues:read', organizationScope: { source: 'session', optional: true } })
  save(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: SaveSupplierEightDDto, @Headers('idempotency-key') key: string) {
    return this.service.save(actor(request), id, body, requestTraceId(request), key);
  }

  @Post(':id/analysis-complete') @ApiCreatedResponse({ type: SupplierEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:write', organizationScope: { source: 'session', optional: true } })
  analysisComplete(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: SupplierEightDAnalysisCompleteDto, @Headers('idempotency-key') key: string) {
    return this.service.analysisComplete(actor(request), id, body, requestTraceId(request), key);
  }

  @Post(':id/submit') @ApiCreatedResponse({ type: SupplierEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:write', organizationScope: { source: 'session', optional: true } })
  submit(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: SupplierEightDVersionDto, @Headers('idempotency-key') key: string) {
    return this.service.submit(actor(request), id, body, requestTraceId(request), key);
  }

  @Put(':id/deadlines') @ApiOkResponse({ type: SupplierEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:issues:deadlines', organizationScope: { source: 'session', optional: true } })
  deadlines(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: SupplierEightDDeadlinesDto, @Headers('idempotency-key') key: string) {
    return this.service.deadlines(actor(request), id, body, requestTraceId(request), key);
  }
}

@Controller('api/v1/supplier-portal/eight-d')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierPortalEightDController {
  constructor(private readonly service: SupplierEightDService) {}

  @Get(':id') @ApiOkResponse({ type: SupplierEightDReportDto })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:read', organizationScope: { source: 'session', optional: true } })
  read(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.read(actor(request), id); }

  @Put(':id') @ApiOkResponse({ type: SupplierEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:write', organizationScope: { source: 'session', optional: true } })
  save(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: SaveSupplierEightDDto, @Headers('idempotency-key') key: string) {
    return this.service.save(actor(request), id, body, requestTraceId(request), key);
  }

  @Post(':id/analysis-complete') @ApiCreatedResponse({ type: SupplierEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:write', organizationScope: { source: 'session', optional: true } })
  analysisComplete(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: SupplierEightDAnalysisCompleteDto, @Headers('idempotency-key') key: string) {
    return this.service.analysisComplete(actor(request), id, body, requestTraceId(request), key);
  }

  @Post(':id/submit') @ApiCreatedResponse({ type: SupplierEightDReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:write', organizationScope: { source: 'session', optional: true } })
  submit(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: SupplierEightDVersionDto, @Headers('idempotency-key') key: string) {
    return this.service.submit(actor(request), id, body, requestTraceId(request), key);
  }
}
