import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ProblemIndexService } from './problem-index.service.js';
import { ProblemIndexPageResponseDto, ProblemIndexQueryDto, ProblemIndexResponseDto } from './problem-index.dto.js';

@Controller('api/v1/problem-index')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
@RequireAccess({ featurePermission: 'problem-index:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
export class ProblemIndexController {
  constructor(private readonly problems: ProblemIndexService) {}

  @Get()
  @ApiOkResponse({ type: ProblemIndexPageResponseDto })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  list(@Query() query: ProblemIndexQueryDto, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    return this.problems.findIndexPage({ ...query, organizationId: authorized.authorizedOrganizationId! });
  }

  @Get(':id')
  @ApiOkResponse({ type: ProblemIndexResponseDto })
  @ApiParam({ name: 'id', type: String })
  find(@Param('id') id: string, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    return this.problems.findById(id, authorized.authorizedOrganizationId!);
  }

  @Get(':id/workspace')
  @ApiOkResponse({ type: ProblemIndexResponseDto })
  @ApiParam({ name: 'id', type: String })
  workspace(@Param('id') id: string, @Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    return this.problems.findById(id, authorized.authorizedOrganizationId!);
  }
}
