import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { WorkflowDefinitionService } from './workflow-definition.service.js';
import type { WorkflowDraft } from './workflow-validation.service.js';
import { CopyWorkflowDto, CreateWorkflowDto, UpdateWorkflowDraftDto, PublishWorkflowDto, WorkflowDefinitionDetailDto, WorkflowDefinitionResponseDto, WorkflowGraphDto, WorkflowOptionsDto, WorkflowOptionsQueryDto, WorkflowPageDto, WorkflowQueryDto, WorkflowValidationResponseDto } from './workflow.dto.js';

function context(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { organizationId: session.user.organizationId, userId: session.user.id, actor: { ...session.user, sessionId: session.id }, traceId: requestTraceId(request) };
}

function graph(body: WorkflowGraphDto): WorkflowDraft {
  return { nodes: body.nodes.map((node) => ({ ...node, ...(node.config === undefined ? {} : { config: node.config as unknown as Record<string, unknown> }) })), transitions: body.transitions.map((edge) => ({ ...edge, ...(edge.condition === undefined ? {} : { condition: edge.condition as unknown as Record<string, unknown> }) })) } as WorkflowDraft;
}

@Controller('api/v1/workflows')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
@RequireAccess({ featurePermission: 'workflow:manage', organizationScope: { source: 'session', optional: true } })
export class WorkflowController {
  constructor(private readonly workflows: WorkflowDefinitionService) {}

  @Get()
  @ApiOkResponse({ type: WorkflowPageDto })
  list(@Query() query: WorkflowQueryDto, @Req() request: AuthorizedRequest) {
    return this.workflows.list(context(request).actor, query);
  }

  @Get('options')
  @ApiOkResponse({ type: WorkflowOptionsDto })
  options(@Query() query: WorkflowOptionsQueryDto, @Req() request: AuthorizedRequest) {
    return this.workflows.options(context(request).actor, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: WorkflowDefinitionDetailDto })
  detail(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthorizedRequest) {
    return this.workflows.detail(context(request).actor, id);
  }

  @Get(':id/versions/:versionId')
  @ApiOkResponse({ type: WorkflowDefinitionResponseDto })
  version(@Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Req() request: AuthorizedRequest) {
    return this.workflows.version(context(request).actor, id, versionId);
  }

  @Post()
  @ApiResponse({ status: 201, type: WorkflowDefinitionResponseDto })
  create(@Body() body: CreateWorkflowDto, @Req() request: AuthorizedRequest) {
    return this.workflows.createDraft({ ...context(request), code: body.code, name: body.name, description: body.description, draft: graph(body) });
  }

  @Post('validate')
  @ApiResponse({ status: 201, type: WorkflowValidationResponseDto })
  validateGraph(@Body() body: WorkflowGraphDto, @Req() request: AuthorizedRequest) {
    return this.workflows.validateGraph(context(request).actor, graph(body));
  }

  @Patch(':id/draft')
  @ApiOkResponse({ type: WorkflowDefinitionResponseDto })
  updateDraft(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateWorkflowDraftDto, @Req() request: AuthorizedRequest) {
    return this.workflows.updateDraft({ ...context(request), definitionId: id, draftVersionId: body.draftVersionId, expectedRevision: body.expectedRevision, description: body.description, draft: graph(body) });
  }

  @Post(':id/validate')
  @ApiResponse({ status: 201, type: WorkflowValidationResponseDto })
  validate(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthorizedRequest) {
    const input = context(request);
    return this.workflows.validateDraft(input.organizationId, id, input.actor);
  }

  @Post(':id/publish')
  @ApiResponse({ status: 201, type: WorkflowDefinitionResponseDto })
  publish(@Param('id', ParseUUIDPipe) id: string, @Body() body: PublishWorkflowDto, @Req() request: AuthorizedRequest) {
    return this.workflows.publishDefinition({ ...context(request), definitionId: id, draftVersionId: body.draftVersionId, expectedRevision: body.expectedRevision, changeNote: body.changeNote });
  }

  @Post(':id/copy')
  @ApiResponse({ status: 201, type: WorkflowDefinitionResponseDto })
  copy(@Param('id', ParseUUIDPipe) id: string, @Body() body: CopyWorkflowDto, @Req() request: AuthorizedRequest) {
    return this.workflows.copyPublishedVersion({ ...context(request), definitionId: id, sourceVersionId: body.sourceVersionId, expectedRevision: body.expectedRevision, description: body.description });
  }
}
