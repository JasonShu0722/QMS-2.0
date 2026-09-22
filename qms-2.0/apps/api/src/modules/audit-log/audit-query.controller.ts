import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { AuditPageDto, AuditQueryDto } from './audit-query.dto.js';
import { AuditQueryService } from './audit-query.service.js';

@Controller('api/v1/admin/audit-events')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class AuditQueryController {
  constructor(private readonly queries: AuditQueryService) {}

  @Get()
  @RequireAccess({ featurePermission: 'audit:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  @ApiOkResponse({ type: AuditPageDto })
  list(@Query() query: AuditQueryDto, @Req() request: AuthorizedRequest) {
    return this.queries.list({ ...request[AUTHENTICATED_SESSION]!.user, sessionId: request[AUTHENTICATED_SESSION]!.id }, query);
  }
}
