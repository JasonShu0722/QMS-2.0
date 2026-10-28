import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Req, StreamableFile, UnauthorizedException } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiProduces, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { SupplierEightDControlledReportDto, SupplierEightDReportQueryDto } from './supplier-eight-d-report.dto.js';
import { SupplierEightDReportService } from './supplier-eight-d-report.service.js';

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION];
  if (!session) throw new UnauthorizedException({ code: 'AUTH_SESSION_REQUIRED', message: 'AUTH_SESSION_REQUIRED' });
  return { ...session.user, sessionId: session.id, scopeOrganizationId: request.authorizedOrganizationId };
}
const access = { featurePermission: 'supplier-quality:issues:report', organizationScope: { source: 'session', optional: true } } as const;

@Controller('api/v1/supplier-quality/eight-d')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierEightDReportController {
  constructor(private readonly service: SupplierEightDReportService) {}

  @Get(':id/report') @ApiOkResponse({ type: SupplierEightDControlledReportDto })
  @Header('Cache-Control', 'no-store') @Header('X-Content-Type-Options', 'nosniff') @RequireAccess(access)
  read(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Query() query: SupplierEightDReportQueryDto) {
    return this.service.read(actor(request), id, query, requestTraceId(request));
  }

  @Get(':id/report/pdf') @ApiProduces('application/pdf')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @Header('Cache-Control', 'no-store') @Header('X-Content-Type-Options', 'nosniff') @RequireAccess(access)
  async pdf(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Query() query: SupplierEightDReportQueryDto) {
    const output = await this.service.pdf(actor(request), id, query, requestTraceId(request));
    return new StreamableFile(output.content, { type: output.contentType, length: output.content.length, disposition: `attachment; filename="${output.filename}"` });
  }
}

@Controller('api/v1/supplier-portal/eight-d')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierPortalEightDReportController extends SupplierEightDReportController {
  @Get(':id/report') @ApiOkResponse({ type: SupplierEightDControlledReportDto })
  @Header('Cache-Control', 'no-store') @Header('X-Content-Type-Options', 'nosniff')
  @RequireAccess({ featurePermission: 'supplier-quality:responses:read', organizationScope: { source: 'session', optional: true } })
  override read(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Query() query: SupplierEightDReportQueryDto) {
    return super.read(request, id, query);
  }

  @Get(':id/report/pdf') @ApiProduces('application/pdf') @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @Header('Cache-Control', 'no-store') @Header('X-Content-Type-Options', 'nosniff')
  @RequireAccess({ featurePermission: 'supplier-quality:responses:read', organizationScope: { source: 'session', optional: true } })
  override pdf(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Query() query: SupplierEightDReportQueryDto) {
    return super.pdf(request, id, query);
  }
}
