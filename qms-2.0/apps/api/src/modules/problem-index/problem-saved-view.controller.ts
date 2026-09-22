import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ProblemScopeQueryDto } from './problem-index.dto.js';
import { ProblemSavedViewService } from './problem-saved-view.service.js';
import { CreateProblemSavedViewDto, DeleteProblemSavedViewDto, ProblemSavedViewDeletedDto, ProblemSavedViewDto, ProblemSavedViewPageDto, ProblemSavedViewQueryDto, UpdateProblemSavedViewDto } from './problem-saved-view.dto.js';

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id };
}

@Controller('api/v1/problem-views')
@RequireAccess({ featurePermission: 'problem-index:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class ProblemSavedViewController {
  constructor(private readonly views: ProblemSavedViewService) {}

  @Get()
  @ApiOkResponse({ type: ProblemSavedViewPageDto })
  list(@Query() query: ProblemSavedViewQueryDto, @Req() request: AuthorizedRequest) {
    return this.views.list(actor(request), { ...query, organizationId: request.authorizedOrganizationId! });
  }

  @Post()
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiResponse({ status: 201, type: ProblemSavedViewDto })
  create(@Query() _query: ProblemScopeQueryDto, @Body() body: CreateProblemSavedViewDto, @Req() request: AuthorizedRequest) {
    return this.views.create(actor(request), request.authorizedOrganizationId!, body, requestTraceId(request));
  }

  @Patch(':id')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: ProblemSavedViewDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Query() _query: ProblemScopeQueryDto, @Body() body: UpdateProblemSavedViewDto, @Req() request: AuthorizedRequest) {
    return this.views.update(actor(request), request.authorizedOrganizationId!, id, body, requestTraceId(request));
  }

  @Delete(':id')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: ProblemSavedViewDeletedDto })
  remove(@Param('id', ParseUUIDPipe) id: string, @Query() _query: ProblemScopeQueryDto, @Body() body: DeleteProblemSavedViewDto, @Req() request: AuthorizedRequest) {
    return this.views.remove(actor(request), request.authorizedOrganizationId!, id, body, requestTraceId(request));
  }
}
