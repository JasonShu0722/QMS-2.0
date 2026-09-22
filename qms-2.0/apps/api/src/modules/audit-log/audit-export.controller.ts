import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { AuditExportContentDto, AuditExportDto, AuditExportRequestDto } from './audit-export.dto.js';
import { AuditExportService } from './audit-export.service.js';

@Controller('api/v1/admin/audit-exports')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class AuditExportController {
  constructor(private readonly exports: AuditExportService) {}

  @Post()
  @RequireAccess({ featurePermission: 'audit:export', organizationScope: { source: 'body', field: 'organizationId', optional: true } })
  @Header('Cache-Control', 'no-store')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiCreatedResponse({ type: AuditExportDto })
  create(@Body() query: AuditExportRequestDto, @Req() request: AuthorizedRequest) {
    const session = request[AUTHENTICATED_SESSION]!;
    return this.exports.create({ ...session.user, sessionId: session.id }, query, requestTraceId(request));
  }

  @Get(':id')
  @RequireAccess({ featurePermission: 'audit:export', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  @Header('Cache-Control', 'no-store')
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiOkResponse({ type: AuditExportContentDto })
  download(@Param('id', ParseUUIDPipe) id: string, @Query('organizationId', new ParseUUIDPipe({ optional: true })) organizationId: string | undefined, @Req() request: AuthorizedRequest) {
    const session = request[AUTHENTICATED_SESSION]!;
    return this.exports.download({ ...session.user, sessionId: session.id }, organizationId ?? session.user.organizationId, id, requestTraceId(request));
  }
}
