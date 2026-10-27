import { Controller, Get, Header, Inject, Param, ParseUUIDPipe, Query, Req, StreamableFile, type Type } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiProduces, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../contracts/error-response.js';
import { requestTraceId } from '../contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../guards/authenticated.guard.js';
import { RequireAccess } from '../../modules/authorization/access.decorator.js';
import { ProcessEightDControlledReportDto, ProcessEightDReportQueryDto } from '../../modules/process-quality/process-eight-d-report.dto.js';
import { ProcessEightDNotificationPageDto, ProcessEightDTaskPageDto, ProcessEightDTaskQueryDto } from '../../modules/process-quality/process-eight-d-task.dto.js';
import { assertInternalEightDDomain, type InternalEightDDomainDescriptor } from './internal-eight-d-domain.js';
import type { InternalEightDRuntime } from './internal-eight-d-runtime.js';

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: request.authorizedOrganizationId };
}

export function internalEightDDeliveryController(domain: InternalEightDDomainDescriptor, token: symbol): Type<object> {
  assertInternalEightDDomain(domain);
  const reportAccess = { featurePermission: `${domain.permissionPrefix}:report`, organizationScope: { source: 'query', field: 'organizationId', optional: true } } as const;
  @Controller(`api/v1/${domain.domainCode}/eight-d`)
  @ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
  class InternalEightDDeliveryController {
    constructor(@Inject(token) private readonly runtime: InternalEightDRuntime) {}
    @Get('tasks') @ApiOkResponse({ type: ProcessEightDTaskPageDto })
    @RequireAccess({ featurePermission: 'task:read', organizationScope: { source: 'session', optional: true } })
    tasks(@Req() request: AuthorizedRequest, @Query() query: ProcessEightDTaskQueryDto) { return this.runtime.tasks.list(actor(request), query); }
    @Get('notifications') @ApiOkResponse({ type: ProcessEightDNotificationPageDto })
    @RequireAccess({ featurePermission: 'notification:read', organizationScope: { source: 'session', optional: true } })
    notifications(@Req() request: AuthorizedRequest, @Query() query: ProcessEightDTaskQueryDto) { return this.runtime.tasks.notifications(actor(request), query); }
    @Get(':problemId/report') @ApiOkResponse({ type: ProcessEightDControlledReportDto })
    @Header('Cache-Control', 'no-store') @Header('X-Content-Type-Options', 'nosniff') @RequireAccess(reportAccess)
    report(@Req() request: AuthorizedRequest, @Param('problemId', ParseUUIDPipe) id: string, @Query() query: ProcessEightDReportQueryDto) {
      return this.runtime.report.read(actor(request), id, query, requestTraceId(request));
    }
    @Get(':problemId/report/pdf') @ApiProduces('application/pdf') @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
    @Header('Cache-Control', 'no-store') @Header('X-Content-Type-Options', 'nosniff') @RequireAccess(reportAccess)
    async pdf(@Req() request: AuthorizedRequest, @Param('problemId', ParseUUIDPipe) id: string, @Query() query: ProcessEightDReportQueryDto) {
      const output = await this.runtime.report.pdf(actor(request), id, query, requestTraceId(request));
      return new StreamableFile(output.content, { type: output.contentType, length: output.content.length, disposition: `attachment; filename="${output.filename}"` });
    }
  }
  Object.defineProperty(InternalEightDDeliveryController, 'name', { value: `${domain.revisionType}DeliveryController` });
  return InternalEightDDeliveryController;
}
