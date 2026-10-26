import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { WorkflowDeadlineExtensionService } from './workflow-deadline-extension.service.js';
import { DecideWorkflowDeadlineExtensionDto, RequestWorkflowDeadlineExtensionDto, WorkflowDeadlineExtensionDto } from './workflow-deadline-extension.dto.js';
import type { WorkflowDeadlineExtension } from './workflow-deadline-extension.types.js';

function actor(request: AuthorizedRequest) { const s = request[AUTHENTICATED_SESSION]!; return { ...s.user, sessionId: s.id }; }
function projection(r: WorkflowDeadlineExtension): WorkflowDeadlineExtensionDto {
  return { id: r.id, problemId: r.problemId, workflowVersionId: r.workflowVersionId, stage: r.stage, originalDueAt: r.originalDueAt, requestedDueAt: r.requestedDueAt,
    originallyOverdue: r.originallyOverdue, reason: r.reason, applicantUserId: r.applicantUserId, leaderUserId: r.participants.leader.userId,
    professionalUserId: r.participants.professional.userId, leaderSkipped: r.participants.leaderSkipped, status: r.status, version: r.version, history: r.history, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

@Controller('api/v1/workflow-deadline-extensions')
@ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
@RequireAccess({ featurePermission: 'workflow:act', organizationScope: { source: 'session', optional: true } })
export class WorkflowDeadlineExtensionController {
  constructor(private readonly extensions: WorkflowDeadlineExtensionService) {}

  @Get('problems/:problemId/requests') @ApiOkResponse({ type: [WorkflowDeadlineExtensionDto] })
  async history(@Param('problemId', ParseUUIDPipe) id: string, @Req() request: AuthorizedRequest) { return (await this.extensions.history(actor(request), id)).map(projection); }

  @Post('problems/:problemId/requests') @HttpCode(200) @ApiOkResponse({ type: WorkflowDeadlineExtensionDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  async request(@Param('problemId', ParseUUIDPipe) id: string, @Body() body: RequestWorkflowDeadlineExtensionDto, @Headers('idempotency-key') key: string, @Req() request: AuthorizedRequest) {
    return projection(await this.extensions.request(actor(request), id, body, key, requestTraceId(request)));
  }

  @Post('requests/:requestId/decide') @HttpCode(200) @ApiOkResponse({ type: WorkflowDeadlineExtensionDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  async decide(@Param('requestId', ParseUUIDPipe) id: string, @Body() body: DecideWorkflowDeadlineExtensionDto, @Headers('idempotency-key') key: string, @Req() request: AuthorizedRequest) {
    return projection(await this.extensions.decide(actor(request), id, body, key, requestTraceId(request)));
  }
}
