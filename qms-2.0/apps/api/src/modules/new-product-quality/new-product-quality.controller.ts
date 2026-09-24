import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { NewProductQualityService } from './new-product-quality.service.js';
import { ApproveNewProductMassProductionDto, ConfirmNewProductLessonDto, CreateNewProductDeliverableDto, CreateNewProductLegacyIssueDto, CreateNewProductLessonDto, CreateNewProductProjectDto, CreateNewProductStageDto, CreateNewProductTrialBatchDto, EscalateNewProductIssueDto, IssueNewProductDefectsDto, NewProductDeliverableDto, NewProductLessonCheckDto, NewProductLessonDto, NewProductProjectDetailDto, NewProductProjectDto, NewProductScopeDto, NewProductStageDto, NewProductTrialBatchDto, NewProductTrialMetricDto, NewProductTrialReportDto, RecordNewProductMetricDto, ReviewNewProductStageDto, SelectNewProductDefectDto, SubmitNewProductDeliverableDto } from './new-product-quality.dto.js';

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

  @Post('projects/:id/legacy-issues') @ApiCreatedResponse({ type: Object }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  legacyIssue(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateNewProductLegacyIssueDto) { return this.service.createLegacyIssue(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('projects/:id/mass-production-approval') @ApiCreatedResponse({ type: Object }) @RequireAccess({ featurePermission: 'new-product-quality:projects:write', organizationScope: bodyScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  massProductionApproval(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApproveNewProductMassProductionDto) { return this.service.approveMassProduction(actor(request), id, body, requestTraceId(request), request.get('Idempotency-Key')); }
}
