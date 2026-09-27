import { BadRequestException, Body, Controller, Get, Headers, Header, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiProduces, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { QualityDataService } from './quality-data.service.js';
import { CreateInternalQualitySnapshotDto, CreateMetricDefinitionDto, CreateQualitySnapshotDto, MetricDefinitionDto, MetricFactDto, MetricTrendQueryDto, QualityDashboardDto, QualityDashboardQueryDto, QualityDataScopeDto, QualityFactDrilldownDto, QualityFactDrilldownQueryDto, QualityInsightDto, QualityManagementReportQueryDto, QualitySnapshotDetailDto, QualitySnapshotDto, RecordMetricFactDto } from './quality-data.dto.js';
import { renderQualityManagementReport } from './quality-management-report.js';

function actor(request: Request) { const authorized = request as AuthorizedRequest; const session = authorized[AUTHENTICATED_SESSION]!; return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId }; }
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/quality-data')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class QualityDataController {
  constructor(private readonly service: QualityDataService) {}
  @Get('metrics') @ApiOkResponse({ type: [MetricDefinitionDto] }) @RequireAccess({ featurePermission: 'quality-data:metrics:read', organizationScope: queryScope })
  metrics(@Req() request: Request, @Query() query: MetricTrendQueryDto) { return this.service.listDefinitions(actor(request), query.organizationId ?? actor(request).organizationId); }
  @Post('metrics') @ApiCreatedResponse({ type: MetricDefinitionDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'quality-data:metrics:write', organizationScope: bodyScope })
  createMetric(@Req() request: Request, @Body() body: CreateMetricDefinitionDto, @Headers('idempotency-key') key?: string) { return this.service.createDefinition(actor(request), body, requestTraceId(request), key); }
  @Post('facts') @ApiCreatedResponse({ type: MetricFactDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'quality-data:metrics:write', organizationScope: bodyScope })
  recordFact(@Req() request: Request, @Body() body: RecordMetricFactDto, @Headers('idempotency-key') key?: string) { return this.service.recordFact(actor(request), body, requestTraceId(request), key); }
  @Post('snapshots') @ApiCreatedResponse({ type: QualitySnapshotDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'quality-data:metrics:write', organizationScope: bodyScope })
  snapshot(@Req() request: Request, @Body() body: CreateQualitySnapshotDto, @Headers('idempotency-key') key?: string) { return this.service.createSnapshot(actor(request), body, requestTraceId(request), key); }
  @Post('snapshots/internal') @ApiCreatedResponse({ type: QualitySnapshotDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'quality-data:metrics:write', organizationScope: bodyScope })
  internalSnapshot(@Req() request: Request, @Body() body: CreateInternalQualitySnapshotDto, @Headers('idempotency-key') key?: string) { return this.service.createInternalSnapshot(actor(request), body, requestTraceId(request), key); }
  @Get('snapshots/:id') @ApiOkResponse({ type: QualitySnapshotDetailDto }) @RequireAccess({ featurePermission: 'quality-data:metrics:read', organizationScope: queryScope })
  snapshotDetail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() query: QualityDataScopeDto) { return this.service.snapshotDetail(actor(request), id, query); }
  @Get('facts/:id/drilldown') @ApiOkResponse({ type: QualityFactDrilldownDto }) @RequireAccess({ featurePermission: 'quality-data:metrics:read', organizationScope: queryScope })
  factDrilldown(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() query: QualityFactDrilldownQueryDto) { return this.service.factDrilldown(actor(request), id, query); }
  @Get('trend') @ApiOkResponse({ type: [MetricFactDto] }) @RequireAccess({ featurePermission: 'quality-data:metrics:read', organizationScope: queryScope })
  trend(@Req() request: Request, @Query() query: MetricTrendQueryDto) { return this.service.trend(actor(request), query); }
  @Get('dashboard') @ApiOkResponse({ type: QualityDashboardDto }) @RequireAccess({ featurePermission: 'quality-data:metrics:read', organizationScope: queryScope })
  dashboard(@Req() request: Request, @Query() query: QualityDashboardQueryDto) { return this.service.dashboard(actor(request), query); }
  @Get('insights') @ApiOkResponse({ type: [QualityInsightDto] }) @RequireAccess({ featurePermission: 'quality-data:metrics:read', organizationScope: queryScope })
  insights(@Req() request: Request, @Query() query: MetricTrendQueryDto) { return this.service.insights(actor(request), query); }

  @Get('management-report/export/:format') @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf') @ApiOkResponse({ schema: { type: 'string', format: 'binary' } }) @RequireAccess({ featurePermission: 'quality-data:metrics:read', organizationScope: queryScope })
  @Header('Cache-Control', 'no-store')
  async managementReport(@Req() request: Request, @Res() response: Response, @Param('format') format: string, @Query() query: QualityManagementReportQueryDto) {
    if (format !== 'xlsx' && format !== 'pdf') throw new BadRequestException('Unsupported report format');
    const report = await this.service.dashboard(actor(request), query);
    const file = await renderQualityManagementReport(report.cards, { from: report.from, to: report.to, generatedAt: report.generatedAt }, format);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="qms-quality-management-${new Date().toISOString().slice(0, 10)}.${format}"`);
    response.send(file.content);
  }
}
