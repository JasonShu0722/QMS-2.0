import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ProcessDefectLedgerService } from './process-defect-ledger.service.js';
import { ProcessIssueService } from './process-issue.service.js';
import { ProcessProductionService } from './process-production.service.js';
import { ProcessShipmentReportService } from './process-shipment-report.service.js';
import { ArchiveProcessDefectDto, ArchiveProcessShipmentReportDto, AssociateProcessShipmentReportCustomerDto, CorrectProcessProductionDto, CreateProcessDefectDto, CreateProcessDefectTypeDto, CreateProcessProductionDto, CreateProcessShipmentReportDto, IssueProcessDefectsDto, LinkProcessShipmentReportIssueDto, ProcessDefectDto, ProcessDefectPageDto, ProcessDefectQueryDto, ProcessDefectTypeDto, ProcessIssueProblemDto, ProcessIssueResultDto, ProcessProductionDetailDto, ProcessProductionDto, ProcessProductionPageDto, ProcessProductionPeriodQueryDto, ProcessProductionQueryDto, ProcessProductionSummaryDto, ProcessScopeDto, ProcessShipmentReportDto, ProcessShipmentReportPageDto, ProcessShipmentReportQueryDto, UpdateProcessDefectDto, UpdateProcessDefectTypeDto, UpdateProcessShipmentReportEvidenceDto } from './process-quality.dto.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}

const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/process-quality')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class ProcessQualityController {
  constructor(private readonly service: ProcessDefectLedgerService, private readonly issues: ProcessIssueService, private readonly production: ProcessProductionService, private readonly shipmentReports: ProcessShipmentReportService) {}

  @Post('production-batches') @ApiCreatedResponse({ type: ProcessProductionDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:defects:write', organizationScope: bodyScope })
  createProduction(@Req() request: Request, @Body() body: CreateProcessProductionDto, @Headers('idempotency-key') key?: string) {
    return this.production.create(actor(request), body, requestTraceId(request), key);
  }

  @Get('production-batches') @ApiOkResponse({ type: ProcessProductionPageDto })
  @RequireAccess({ featurePermission: 'process-quality:defects:read', organizationScope: queryScope })
  productionBatches(@Req() request: Request, @Query() query: ProcessProductionQueryDto) { return this.production.list(actor(request), query); }

  @Get('production-batches/summary') @ApiOkResponse({ type: ProcessProductionSummaryDto })
  @RequireAccess({ featurePermission: 'process-quality:defects:read', organizationScope: queryScope })
  productionSummary(@Req() request: Request, @Query() query: ProcessProductionPeriodQueryDto) { return this.production.summary(actor(request), query); }

  @Get('production-batches/:id') @ApiOkResponse({ type: ProcessProductionDetailDto })
  @RequireAccess({ featurePermission: 'process-quality:defects:read', organizationScope: queryScope })
  productionDetail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: ProcessScopeDto) { return this.production.detail(actor(request), id); }

  @Put('production-batches/:id/correct') @ApiOkResponse({ type: ProcessProductionDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:defects:write', organizationScope: bodyScope })
  correctProduction(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CorrectProcessProductionDto, @Headers('idempotency-key') key?: string) {
    return this.production.correct(actor(request), id, body, requestTraceId(request), key);
  }

  @Post('shipment-reports') @ApiCreatedResponse({ type: ProcessShipmentReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:defects:write', organizationScope: bodyScope })
  createShipmentReport(@Req() request: Request, @Body() body: CreateProcessShipmentReportDto, @Headers('idempotency-key') key?: string) {
    return this.shipmentReports.create(actor(request), body, requestTraceId(request), key);
  }

  @Get('shipment-reports') @ApiOkResponse({ type: ProcessShipmentReportPageDto })
  @RequireAccess({ featurePermission: 'process-quality:defects:read', organizationScope: queryScope })
  shipmentReportList(@Req() request: Request, @Query() query: ProcessShipmentReportQueryDto) {
    return this.shipmentReports.list(actor(request), query);
  }

  @Get('shipment-reports/:id') @ApiOkResponse({ type: ProcessShipmentReportDto })
  @RequireAccess({ featurePermission: 'process-quality:defects:read', organizationScope: queryScope })
  shipmentReportDetail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: ProcessScopeDto) {
    return this.shipmentReports.detail(actor(request), id);
  }

  @Put('shipment-reports/:id/archive') @ApiOkResponse({ type: ProcessShipmentReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:defects:write', organizationScope: bodyScope })
  archiveShipmentReport(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ArchiveProcessShipmentReportDto, @Headers('idempotency-key') key?: string) {
    return this.shipmentReports.archive(actor(request), id, body.expectedVersion, requestTraceId(request), key);
  }

  @Put('shipment-reports/:id/evidence') @ApiOkResponse({ type: ProcessShipmentReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:defects:write', organizationScope: bodyScope })
  updateShipmentReportEvidence(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateProcessShipmentReportEvidenceDto, @Headers('idempotency-key') key?: string) {
    return this.shipmentReports.updateEvidence(actor(request), id, body, requestTraceId(request), key);
  }

  @Put('shipment-reports/:id/customer') @ApiOkResponse({ type: ProcessShipmentReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:defects:write', organizationScope: bodyScope })
  associateShipmentReportCustomer(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: AssociateProcessShipmentReportCustomerDto, @Headers('idempotency-key') key?: string) {
    return this.shipmentReports.associateCustomer(actor(request), id, body, requestTraceId(request), key);
  }

  @Post('shipment-reports/:id/issues') @ApiCreatedResponse({ type: ProcessShipmentReportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:defects:write', organizationScope: bodyScope })
  linkShipmentReportIssue(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: LinkProcessShipmentReportIssueDto, @Headers('idempotency-key') key?: string) {
    return this.shipmentReports.linkIssue(actor(request), id, body, requestTraceId(request), key);
  }

  @Post('defect-types') @ApiCreatedResponse({ type: ProcessDefectTypeDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:defects:write', organizationScope: bodyScope })
  createType(@Req() request: Request, @Body() body: CreateProcessDefectTypeDto, @Headers('idempotency-key') key?: string) {
    return this.service.createDefectType(actor(request), body, requestTraceId(request), key);
  }

  @Get('defect-types') @ApiOkResponse({ type: [ProcessDefectTypeDto] })
  @RequireAccess({ featurePermission: 'process-quality:defects:read', organizationScope: queryScope })
  types(@Req() request: Request, @Query() _query: ProcessScopeDto) { return this.service.defectTypes(actor(request)); }

  @Put('defect-types/:id') @ApiOkResponse({ type: ProcessDefectTypeDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:defects:write', organizationScope: bodyScope })
  updateType(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateProcessDefectTypeDto, @Headers('idempotency-key') key?: string) {
    return this.service.updateDefectType(actor(request), id, body, requestTraceId(request), key);
  }

  @Post('defects') @ApiCreatedResponse({ type: ProcessDefectDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:defects:write', organizationScope: bodyScope })
  create(@Req() request: Request, @Body() body: CreateProcessDefectDto, @Headers('idempotency-key') key?: string) {
    return this.service.create(actor(request), body, requestTraceId(request), key);
  }

  @Get('defects') @ApiOkResponse({ type: ProcessDefectPageDto })
  @RequireAccess({ featurePermission: 'process-quality:defects:read', organizationScope: queryScope })
  list(@Req() request: Request, @Query() query: ProcessDefectQueryDto) { return this.service.list(actor(request), query); }

  @Get('defects/:id') @ApiOkResponse({ type: ProcessDefectDto })
  @RequireAccess({ featurePermission: 'process-quality:defects:read', organizationScope: queryScope })
  detail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: ProcessScopeDto) { return this.service.detail(actor(request), id); }

  @Put('defects/:id') @ApiOkResponse({ type: ProcessDefectDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:defects:write', organizationScope: bodyScope })
  update(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateProcessDefectDto, @Headers('idempotency-key') key?: string) {
    return this.service.update(actor(request), id, body, requestTraceId(request), key);
  }

  @Put('defects/:id/archive') @ApiOkResponse({ type: ProcessDefectDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:defects:write', organizationScope: bodyScope })
  archive(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ArchiveProcessDefectDto, @Headers('idempotency-key') key?: string) {
    return this.service.archive(actor(request), id, body.expectedVersion, requestTraceId(request), key);
  }

  @Post('issues') @ApiCreatedResponse({ type: ProcessIssueResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:defects:write', organizationScope: bodyScope })
  issue(@Req() request: Request, @Body() body: IssueProcessDefectsDto, @Headers('idempotency-key') key?: string) {
    return this.issues.issue(actor(request), body, requestTraceId(request), key);
  }

  @Get('defects/:id/issues') @ApiOkResponse({ type: [ProcessIssueProblemDto] })
  @RequireAccess({ featurePermission: 'process-quality:defects:read', organizationScope: queryScope })
  linkedIssues(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: ProcessScopeDto) {
    return this.issues.problemsForDefect(actor(request), id);
  }
}
