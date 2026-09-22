import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { RequireAccess } from '../authorization/access.decorator.js';
import type { Request } from 'express';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ReportingService } from './reporting.service.js';
import { ProblemIndexQueryDto } from '../problem-index/problem-index.dto.js';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { ProblemIndexPageResponseDto } from '../problem-index/problem-index.dto.js';
import { ProblemWorkspaceQueryDto } from '../problem-index/problem-workspace.dto.js';
import { ProblemReportDto } from './reporting.dto.js';
import { ProblemAuditQueryService } from '../audit-log/problem-audit-query.service.js';
import { ProblemAuditPageDto, ProblemAuditQueryDto } from '../audit-log/problem-audit-query.dto.js';

export function problemReader(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { actor: { ...session.user, sessionId: session.id }, organizationId: authorized.authorizedOrganizationId! };
}

@Controller('api/v1')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
@RequireAccess({ featurePermission: 'problem-index:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
export class ReportingController {
  constructor(private readonly reporting: ReportingService, private readonly trail: ProblemAuditQueryService) {}
  @Get('problem-center')
  @ApiOkResponse({ type: ProblemIndexPageResponseDto })
  list(@Query() query: ProblemIndexQueryDto, @Req() request: Request) {
    const { actor, organizationId } = problemReader(request);
    return this.reporting.list(actor, { ...query, organizationId });
  }
  @Get('reports/problems/:id')
  @ApiOkResponse({ type: ProblemReportDto })
  report(@Param('id', ParseUUIDPipe) id: string, @Query() query: ProblemWorkspaceQueryDto, @Req() request: Request) {
    const { actor, organizationId } = problemReader(request);
    return this.reporting.report(actor, organizationId, id, query);
  }
  @Get('problems/:id/audit-trail')
  @ApiOkResponse({ type: ProblemAuditPageDto })
  audit(@Param('id', ParseUUIDPipe) id: string, @Query() query: ProblemAuditQueryDto, @Req() request: Request) {
    const { actor, organizationId } = problemReader(request);
    return this.trail.read(actor, organizationId, id, query);
  }
}
