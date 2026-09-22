import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { OutboxFailurePageDto, OutboxFailureQueryDto, OutboxRetryDto, OutboxScopeDto } from './outbox-administration.dto.js';
import { OutboxAdministrationService } from './outbox-administration.service.js';

@Controller('api/v1/outbox/failures')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class OutboxAdministrationController {
  constructor(private readonly administration: OutboxAdministrationService) {}

  @Get()
  @RequireAccess({ featurePermission: 'outbox:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  @ApiOkResponse({ type: OutboxFailurePageDto })
  list(@Query() query: OutboxFailureQueryDto, @Req() request: AuthorizedRequest) {
    return this.administration.list({ ...request[AUTHENTICATED_SESSION]!.user, sessionId: request[AUTHENTICATED_SESSION]!.id }, query);
  }

  @Post(':id/retry')
  @RequireAccess({ featurePermission: 'outbox:retry', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiResponse({ status: 201, type: OutboxRetryDto })
  retry(@Param('id', ParseUUIDPipe) id: string, @Query() _query: OutboxScopeDto, @Req() request: AuthorizedRequest) {
    return this.administration.retry({ ...request[AUTHENTICATED_SESSION]!.user, sessionId: request[AUTHENTICATED_SESSION]!.id }, id, request.authorizedOrganizationId!, requestTraceId(request));
  }
}
