import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ProblemQueryService } from './problem-query.service.js';
import { ProblemIndexPageResponseDto, ProblemIndexQueryDto, ProblemIndexResponseDto } from './problem-index.dto.js';
import { ProblemWorkspaceService } from './problem-workspace.service.js';
import { ProblemWorkspaceDto, ProblemWorkspaceQueryDto } from './problem-workspace.dto.js';

@Controller('api/v1/problem-index')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
@RequireAccess({ featurePermission: 'problem-index:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
export class ProblemIndexController {
  constructor(private readonly problems: ProblemQueryService, private readonly workspaces: ProblemWorkspaceService) {}

  @Get()
  @ApiOkResponse({ type: ProblemIndexPageResponseDto })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  list(@Query() query: ProblemIndexQueryDto, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    return this.problems.list({ ...authorized[AUTHENTICATED_SESSION]!.user, sessionId: authorized[AUTHENTICATED_SESSION]!.id }, { ...query, organizationId: authorized.authorizedOrganizationId! });
  }

  @Get(':id')
  @ApiOkResponse({ type: ProblemIndexResponseDto })
  @ApiParam({ name: 'id', type: String })
  find(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    return this.problems.find({ ...authorized[AUTHENTICATED_SESSION]!.user, sessionId: authorized[AUTHENTICATED_SESSION]!.id }, authorized.authorizedOrganizationId!, id);
  }

  @Get(':id/workspace')
  @ApiOkResponse({ type: ProblemWorkspaceDto })
  @ApiParam({ name: 'id', type: String })
  workspace(@Param('id', ParseUUIDPipe) id: string, @Query() query: ProblemWorkspaceQueryDto, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    return this.workspaces.read({ ...authorized[AUTHENTICATED_SESSION]!.user, sessionId: authorized[AUTHENTICATED_SESSION]!.id }, authorized.authorizedOrganizationId!, id, query);
  }
}
