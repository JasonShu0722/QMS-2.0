import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Req, StreamableFile, UnauthorizedException } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiProduces, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ProcessEightDControlledReportDto, ProcessEightDReportQueryDto } from './process-eight-d-report.dto.js';
import { ProcessEightDReportService } from './process-eight-d-report.service.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION];
  if (!session) throw new UnauthorizedException({ code: 'AUTH_SESSION_REQUIRED', message: 'AUTH_SESSION_REQUIRED' });
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}
const access = { featurePermission: 'process-quality:issues:report', organizationScope: { source: 'query', field: 'organizationId', optional: true } } as const;

@Controller('api/v1/process-quality/eight-d')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class ProcessEightDReportController {
  constructor(private readonly service: ProcessEightDReportService) {}

  @Get(':problemId/report')
  @ApiOkResponse({ type: ProcessEightDControlledReportDto })
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequireAccess(access)
  read(@Req() request: Request, @Param('problemId', ParseUUIDPipe) problemId: string, @Query() query: ProcessEightDReportQueryDto) {
    return this.service.read(actor(request), problemId, query, requestTraceId(request));
  }

  @Get(':problemId/report/pdf')
  @ApiProduces('application/pdf')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequireAccess(access)
  async pdf(@Req() request: Request, @Param('problemId', ParseUUIDPipe) problemId: string, @Query() query: ProcessEightDReportQueryDto) {
    const output = await this.service.pdf(actor(request), problemId, query, requestTraceId(request));
    return new StreamableFile(output.content, { type: output.contentType, length: output.content.length, disposition: `attachment; filename="${output.filename}"` });
  }
}
