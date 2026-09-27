import { BadRequestException, Body, Controller, Get, Header, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiParam, ApiProduces, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { NewProductQualityService } from './new-product-quality.service.js';
import { ApproveNewProductEarlyFlowDto, ApproveNewProductMassProductionDto, AssignNewProductIssueDto, CloseNewProductIssueDto, ConfirmNewProductLessonDto, CreateNewProductDeliverableDto, CreateNewProductEarlyFlowDto, CreateNewProductLegacyIssueDto, CreateNewProductLessonDto, CreateNewProductProjectDto, CreateNewProductStageDto, CreateNewProductTrialBatchDto, CreateNewProductTrialSummaryDto, DecideNewProductEarlyFlowReleaseDto, DecideNewProductTrialSummaryDto, EscalateNewProductIssueDto, HandoverNewProductProjectDto, IssueNewProductDefectsDto, NewProductDeliverableDto, NewProductEarlyFlowDto, NewProductEarlyFlowReleaseDto, NewProductHandoverDto, NewProductIssueDto, NewProductIssueListDto, NewProductLessonCheckDto, NewProductLessonDto, NewProductProjectDetailDto, NewProductProjectDto, NewProductScopeDto, NewProductStageDto, NewProductTrialBatchDto, NewProductTrialMetricDto, NewProductTrialReportDto, NewProductTrialSummaryDto, NewProductTrialSummaryRevisionDto, RecordNewProductMeasureDto, RecordNewProductMetricDto, ReviseNewProductEarlyFlowDto, ReviseNewProductTrialSummaryDto, ReviewNewProductStageDto, SelectNewProductDefectDto, SubmitNewProductDeliverableDto, SubmitNewProductEarlyFlowDto, SubmitNewProductTrialSummaryDto, VerifyNewProductIssueDto } from './new-product-quality.dto.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}

const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;
@Controller('api/v1/new-product-quality')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class NewProductQualityController {
  constructor(private readonly service: NewProductQualityService) {}

  @Post('projects') @ApiCreatedResponse({ type: NewProductProjectDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  createProject(@Req() request: Request, @Body() body: CreateNewProductProjectDto) { return this.service.createProject(actor(request), body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get('projects/:id') @ApiOkResponse({ type: NewProductProjectDetailDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:read', organizationScope: queryScope })
  project(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: NewProductScopeDto) { return this.service.projectDetail(actor(request), id); }

  @Post('projects/:id/stages') @ApiCreatedResponse({ type: NewProductStageDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  addStage(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateNewProductStageDto) { return this.service.addStage(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('stages/:id/deliverables') @ApiCreatedResponse({ type: NewProductDeliverableDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  addDeliverable(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateNewProductDeliverableDto) { return this.service.addDeliverable(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put('deliverables/:id') @ApiOkResponse({ type: NewProductDeliverableDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  submitDeliverable(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: SubmitNewProductDeliverableDto) { return this.service.submitDeliverable(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('lessons') @ApiCreatedResponse({ type: NewProductLessonDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  createLesson(@Req() request: Request, @Body() body: CreateNewProductLessonDto) { return this.service.createLesson(actor(request), body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('projects/:projectId/lessons/:lessonId') @ApiCreatedResponse({ type: NewProductLessonCheckDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  attachLesson(@Req() request: Request, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('lessonId', ParseUUIDPipe) lessonId: string, @Body() _body: NewProductScopeDto) { return this.service.attachLesson(actor(request), projectId, lessonId, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put('lesson-checks/:id') @ApiOkResponse({ type: NewProductLessonCheckDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  confirmLesson(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ConfirmNewProductLessonDto) { return this.service.confirmLesson(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('stages/:id/review') @ApiCreatedResponse({ type: NewProductStageDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  reviewStage(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewNewProductStageDto) { return this.service.reviewStage(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('projects/:id/trial-batches') @ApiCreatedResponse({ type: NewProductTrialBatchDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  createTrialBatch(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateNewProductTrialBatchDto) { return this.service.createTrialBatch(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('trial-batches/:id/metrics') @ApiCreatedResponse({ type: NewProductTrialMetricDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  recordMetric(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: RecordNewProductMetricDto) { return this.service.recordMetric(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get('trial-batches/:id/report') @ApiOkResponse({ type: NewProductTrialReportDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:read', organizationScope: queryScope })
  trialReport(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: NewProductScopeDto) { return this.service.trialReport(actor(request), id); }

  @Get('trial-batches/:id/report/export') @ApiProduces('text/csv') @ApiOkResponse({ schema: { type: 'string' } }) @RequireAccess({ featurePermission: 'new-product-quality:projects:read', organizationScope: queryScope })
  @Header('Cache-Control', 'no-store')
  async exportTrialReport(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param('id', ParseUUIDPipe) id: string, @Query() _query: NewProductScopeDto) {
    const exportFile = await this.service.trialReportCsv(actor(request), id);
    response.setHeader('Content-Type', exportFile.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${exportFile.filename}"`);
    return exportFile.content;
  }

  @Post('trial-batches/:id/summary') @ApiCreatedResponse({ type: NewProductTrialSummaryDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  createTrialSummary(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateNewProductTrialSummaryDto) { return this.service.createTrialSummary(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get('trial-batches/:id/summary') @ApiOkResponse({ type: NewProductTrialSummaryDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:read', organizationScope: queryScope })
  trialSummary(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) { return this.service.trialSummary(actor(request), id); }

  @Get('trial-batches/:id/summary/revisions') @ApiOkResponse({ type: [NewProductTrialSummaryRevisionDto] }) @RequireAccess({ featurePermission: 'new-product-quality:projects:read', organizationScope: queryScope })
  trialSummaryRevisions(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) { return this.service.trialSummaryRevisions(actor(request), id); }

  @Get('trial-batches/:id/summary/export/:format') @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf') @ApiOkResponse({ schema: { type: 'string', format: 'binary' } }) @RequireAccess({ featurePermission: 'new-product-quality:projects:read', organizationScope: queryScope })
  @ApiParam({ name: 'format', enum: ['xlsx', 'pdf'] })
  @ApiQuery({ name: 'expectedVersion', type: Number, minimum: 1, required: true })
  @ApiQuery({ name: 'organizationId', type: String, format: 'uuid', required: false })
  @Header('Cache-Control', 'no-store')
  async exportTrialSummary(@Req() request: Request, @Res() response: Response, @Param('id', ParseUUIDPipe) id: string, @Param('format') format: string, @Query('expectedVersion', ParseIntPipe) expectedVersion: number) {
    if (format !== 'xlsx' && format !== 'pdf') throw new BadRequestException('Unsupported report format');
    const file = await this.service.trialSummaryFile(actor(request), id, format, expectedVersion);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.send(file.content);
  }

  @Put('trial-batches/:id/summary/revise') @ApiOkResponse({ type: NewProductTrialSummaryDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  reviseTrialSummary(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviseNewProductTrialSummaryDto) { return this.service.reviseTrialSummary(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put('trial-batches/:id/summary/submit') @ApiOkResponse({ type: NewProductTrialSummaryDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  submitTrialSummary(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: SubmitNewProductTrialSummaryDto) { return this.service.submitTrialSummary(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put('trial-batches/:id/summary/decision') @ApiOkResponse({ type: NewProductTrialSummaryDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  decideTrialSummary(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecideNewProductTrialSummaryDto) { return this.service.decideTrialSummary(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('projects/:id/early-flow') @ApiCreatedResponse({ type: NewProductEarlyFlowDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  createEarlyFlow(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateNewProductEarlyFlowDto) { return this.service.createEarlyFlow(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put('early-flows/:id/revise') @ApiOkResponse({ type: NewProductEarlyFlowDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  reviseEarlyFlow(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviseNewProductEarlyFlowDto) { return this.service.reviseEarlyFlow(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get('projects/:id/early-flow') @ApiOkResponse({ type: NewProductEarlyFlowDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:read', organizationScope: queryScope })
  earlyFlow(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) { return this.service.earlyFlow(actor(request), id); }

  @Put('early-flows/:id/submit') @ApiOkResponse({ type: NewProductEarlyFlowDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  submitEarlyFlow(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: SubmitNewProductEarlyFlowDto) { return this.service.submitEarlyFlow(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put('early-flows/:id/approve') @ApiOkResponse({ type: NewProductEarlyFlowDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  approveEarlyFlow(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApproveNewProductEarlyFlowDto) { return this.service.approveEarlyFlow(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put('early-flows/:id/release') @ApiOkResponse({ type: NewProductEarlyFlowReleaseDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  decideEarlyFlowRelease(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecideNewProductEarlyFlowReleaseDto) { return this.service.decideEarlyFlowRelease(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get('early-flows/:id/releases') @ApiOkResponse({ type: [NewProductEarlyFlowReleaseDto] }) @RequireAccess({ featurePermission: 'new-product-quality:projects:read', organizationScope: queryScope })
  releases(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) { return this.service.earlyFlowReleases(actor(request), id); }

  @Post('projects/:id/defect-selections') @ApiCreatedResponse({ type: Object }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  selectDefect(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: SelectNewProductDefectDto) { return this.service.selectProcessDefect(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get('projects/:id/defect-selections') @ApiOkResponse({ type: [Object] }) @RequireAccess({ featurePermission: 'new-product-quality:projects:read', organizationScope: queryScope })
  selectedDefects(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: NewProductScopeDto) { return this.service.selectedDefects(actor(request), id); }

  @Post('projects/:id/issues') @ApiCreatedResponse({ type: Object }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  issueDefects(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: IssueNewProductDefectsDto) { return this.service.issueSelectedDefects(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('issues/:id/escalate') @ApiOkResponse({ type: Object }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  escalateIssue(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: EscalateNewProductIssueDto) { return this.service.escalateIssue(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get('projects/:id/issues') @ApiOkResponse({ type: NewProductIssueListDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:read', organizationScope: queryScope })
  issues(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) { return this.service.issueListForProject(actor(request), id); }

  @Put('issues/:id/assign') @ApiOkResponse({ type: NewProductIssueDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  assignIssue(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: AssignNewProductIssueDto) { return this.service.assignIssue(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put('issues/:id/measure') @ApiOkResponse({ type: NewProductIssueDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  recordIssueMeasure(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: RecordNewProductMeasureDto) { return this.service.recordIssueMeasure(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put('issues/:id/verify') @ApiOkResponse({ type: NewProductIssueDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  verifyIssue(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: VerifyNewProductIssueDto) { return this.service.verifyIssue(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put('issues/:id/close') @ApiOkResponse({ type: NewProductIssueDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  closeIssue(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CloseNewProductIssueDto) { return this.service.closeIssue(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('projects/:id/legacy-issues') @ApiCreatedResponse({ type: Object }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  legacyIssue(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateNewProductLegacyIssueDto) { return this.service.createLegacyIssue(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('projects/:id/mass-production-approval') @ApiCreatedResponse({ type: Object }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  massProductionApproval(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApproveNewProductMassProductionDto) { return this.service.approveMassProduction(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('projects/:id/handover') @ApiCreatedResponse({ type: NewProductHandoverDto }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  handover(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: HandoverNewProductProjectDto) { return this.service.handoverProject(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }
}
