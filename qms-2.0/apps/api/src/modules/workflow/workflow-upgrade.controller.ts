import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { WorkflowUpgradePreviewDto, WorkflowUpgradeRequestDto, WorkflowUpgradeResultDto, WorkflowUpgradeScopeDto } from './workflow-upgrade.dto.js';
import { WorkflowUpgradeService } from './workflow-upgrade.service.js';

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id };
}

@Controller('api/v1/problem-index')
@RequireAuthenticated()
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class WorkflowUpgradeController {
  constructor(private readonly upgrades: WorkflowUpgradeService) {}

  @Get(':id/upgrade-preview')
  @ApiOkResponse({ type: WorkflowUpgradePreviewDto })
  preview(@Param('id', ParseUUIDPipe) id: string, @Query() query: WorkflowUpgradeScopeDto, @Req() request: AuthorizedRequest) {
    return this.upgrades.preview(actor(request), id, query.organizationId);
  }

  @Post(':id/upgrade')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiResponse({ status: 201, type: WorkflowUpgradeResultDto })
  upgrade(@Param('id', ParseUUIDPipe) id: string, @Body() body: WorkflowUpgradeRequestDto, @Headers('idempotency-key') key: string, @Req() request: AuthorizedRequest) {
    return this.upgrades.upgrade(actor(request), id, body, key, requestTraceId(request));
  }
}
