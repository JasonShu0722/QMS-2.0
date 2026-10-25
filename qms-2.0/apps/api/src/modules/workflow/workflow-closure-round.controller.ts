import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { WorkflowClosureRoundService } from './workflow-closure-round.service.js';
import type { WorkflowClosureRound } from './workflow-closure-round.types.js';
import { CancelWorkflowClosureRoundDto, DecideWorkflowClosureRoundDto, StartWorkflowClosureRoundDto, WorkflowClosureRoundDto } from './workflow-closure-round.dto.js';

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id };
}
function projection(round: WorkflowClosureRound): WorkflowClosureRoundDto {
  return { id: round.id, problemId: round.problemId, instanceId: round.instanceId, workflowVersionId: round.workflowVersionId,
    contentVersion: round.contentVersion, roundNumber: round.roundNumber, status: round.status, version: round.version,
    createdAt: round.createdAt, updatedAt: round.updatedAt, duties: round.duties.map(({ id, duty, status, userId, decidedBy, comment, decidedAt, version }) => ({ id, duty, status, userId, decidedBy, comment, decidedAt, version })) };
}

@Controller('api/v1/workflow-closure')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
@RequireAccess({ featurePermission: 'workflow:act', organizationScope: { source: 'session', optional: true } })
export class WorkflowClosureRoundController {
  constructor(private readonly rounds: WorkflowClosureRoundService) {}

  @Get('problems/:problemId/rounds') @ApiOkResponse({ type: [WorkflowClosureRoundDto] })
  async history(@Param('problemId', ParseUUIDPipe) id: string, @Req() request: AuthorizedRequest) {
    return (await this.rounds.history(actor(request), id)).map(projection);
  }
  @Post('problems/:problemId/rounds') @HttpCode(200) @ApiOkResponse({ type: WorkflowClosureRoundDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  async start(@Param('problemId', ParseUUIDPipe) id: string, @Body() input: StartWorkflowClosureRoundDto, @Headers('idempotency-key') key: string, @Req() request: AuthorizedRequest) {
    return projection(await this.rounds.start(actor(request), id, input, key, requestTraceId(request)));
  }
  @Post('rounds/:roundId/decide') @HttpCode(200) @ApiOkResponse({ type: WorkflowClosureRoundDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  async decide(@Param('roundId', ParseUUIDPipe) id: string, @Body() input: DecideWorkflowClosureRoundDto, @Headers('idempotency-key') key: string, @Req() request: AuthorizedRequest) {
    return projection(await this.rounds.decide(actor(request), id, input, key, requestTraceId(request)));
  }
  @Post('rounds/:roundId/cancel') @HttpCode(200) @ApiOkResponse({ type: WorkflowClosureRoundDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  async cancel(@Param('roundId', ParseUUIDPipe) id: string, @Body() input: CancelWorkflowClosureRoundDto, @Headers('idempotency-key') key: string, @Req() request: AuthorizedRequest) {
    return projection(await this.rounds.cancel(actor(request), id, input, key, requestTraceId(request)));
  }
}
