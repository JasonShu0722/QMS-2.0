import { Body, Controller, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiParam, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { WorkflowDefinitionService } from './workflow-definition.service.js';
import { CopyWorkflowDto, CreateWorkflowDto, UpdateWorkflowDraftDto, PublishWorkflowDto, WorkflowDefinitionResponseDto, WorkflowValidationResponseDto } from './workflow.dto.js';

@Controller('api/v1/workflows')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
@RequireAccess({ featurePermission: 'workflow:manage', organizationScope: { source: 'session', optional: true } })
export class WorkflowController {
  constructor(private readonly workflows: WorkflowDefinitionService) {}

  @Post()
  @ApiOkResponse({ type: WorkflowDefinitionResponseDto })
  create(@Body() body: CreateWorkflowDto, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    const session = authorized[AUTHENTICATED_SESSION]!;
    return this.workflows.createDraft({ organizationId: session.user.organizationId, userId: session.user.id, traceId: request.header('x-trace-id') ?? undefined, code: body.code, name: body.name, description: body.description, draft: { nodes: body.nodes, transitions: body.transitions } });
  }

  @Patch(':id/draft')
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: WorkflowDefinitionResponseDto })
  updateDraft(@Param('id') id: string, @Body() body: UpdateWorkflowDraftDto, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    const session = authorized[AUTHENTICATED_SESSION]!;
    return this.workflows.updateDraft({ organizationId: session.user.organizationId, userId: session.user.id, traceId: request.header('x-trace-id') ?? undefined, definitionId: id, description: body.description, draft: { nodes: body.nodes, transitions: body.transitions } });
  }

  @Post(':id/validate')
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: WorkflowValidationResponseDto })
  validate(@Param('id') id: string, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    return this.workflows.validateDraft(authorized[AUTHENTICATED_SESSION]!.user.organizationId, id);
  }

  @Post(':id/publish')
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: WorkflowDefinitionResponseDto })
  publish(@Param('id') id: string, @Body() body: PublishWorkflowDto, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    const session = authorized[AUTHENTICATED_SESSION]!;
    return this.workflows.publishVersion({ organizationId: session.user.organizationId, userId: session.user.id, traceId: request.header('x-trace-id') ?? undefined, definitionId: id, changeNote: body.changeNote });
  }

  @Post(':id/copy')
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: WorkflowDefinitionResponseDto })
  copy(@Param('id') id: string, @Body() body: CopyWorkflowDto, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    const session = authorized[AUTHENTICATED_SESSION]!;
    return this.workflows.copyPublishedVersion({ organizationId: session.user.organizationId, userId: session.user.id, traceId: request.header('x-trace-id') ?? undefined, definitionId: id, sourceVersionId: body.sourceVersionId, description: body.description });
  }
}
