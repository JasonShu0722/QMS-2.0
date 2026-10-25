import { Body, Controller, Get, Headers, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { WorkflowDefinitionResponseDto } from './workflow.dto.js';
import { CreateWorkflowClosureTemplateDto, WorkflowClosureTemplatesDto } from './workflow-closure-template.dto.js';
import { WorkflowClosureTemplateService } from './workflow-closure-template.service.js';

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id };
}

@Controller('api/v1/workflows/closure-templates')
@RequireAccess({ featurePermission: 'workflow:manage', organizationScope: { source: 'session', optional: true } })
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class WorkflowClosureTemplateController {
  constructor(private readonly templates: WorkflowClosureTemplateService) {}

  @Get()
  @ApiOkResponse({ type: WorkflowClosureTemplatesDto })
  list(@Req() request: AuthorizedRequest) { return this.templates.list(actor(request)); }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiResponse({ status: 201, type: WorkflowDefinitionResponseDto })
  initialize(@Body() body: CreateWorkflowClosureTemplateDto, @Headers('idempotency-key') key: string | undefined, @Req() request: AuthorizedRequest) {
    return this.templates.initialize(actor(request), body, key, requestTraceId(request));
  }
}
