import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { WorkflowClosurePreviewInputDto, WorkflowClosurePreviewDto } from './workflow-closure-preview.dto.js';
import { WorkflowClosurePreviewService } from './workflow-closure-preview.service.js';

@Controller('api/v1/workflows')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class WorkflowClosurePreviewController {
  constructor(private readonly preview: WorkflowClosurePreviewService) {}

  @Post('closure-preview') @HttpCode(200)
  @RequireAccess({ featurePermission: 'workflow:manage', organizationScope: { source: 'session', optional: true } })
  @ApiOkResponse({ type: WorkflowClosurePreviewDto })
  resolve(@Body() body: WorkflowClosurePreviewInputDto, @Req() request: AuthorizedRequest) {
    const session = request[AUTHENTICATED_SESSION]!;
    return this.preview.resolve({ ...session.user, sessionId: session.id }, body);
  }
}
