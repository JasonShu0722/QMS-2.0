import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { SupplierEightDDeadlineCancelDto, SupplierEightDDeadlineDecisionDto, SupplierEightDDeadlineRequestDto, SupplierEightDDeadlineResultDto } from './supplier-eight-d-deadline.dto.js';
import { SupplierEightDDeadlineService } from './supplier-eight-d-deadline.service.js';

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: request.authorizedOrganizationId };
}

@Controller('api/v1/supplier-quality/eight-d/:id/deadline-extensions')
@ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierEightDDeadlineController {
  constructor(private readonly service: SupplierEightDDeadlineService) {}

  @Get() @ApiOkResponse({ type: SupplierEightDDeadlineResultDto, isArray: true })
  @RequireAccess({ featurePermission: 'supplier-quality:issues:read', organizationScope: { source: 'session', optional: true } })
  history(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.history(actor(request), id);
  }

  @Post() @ApiCreatedResponse({ type: SupplierEightDDeadlineResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:write', organizationScope: { source: 'session', optional: true } })
  request(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: SupplierEightDDeadlineRequestDto, @Headers('idempotency-key') key: string) {
    return this.service.request(actor(request), id, input, key, requestTraceId(request));
  }

  @Post(':requestId/decide') @HttpCode(200) @ApiOkResponse({ type: SupplierEightDDeadlineResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:issues:deadlines', organizationScope: { source: 'session', optional: true } })
  decide(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() input: SupplierEightDDeadlineDecisionDto, @Headers('idempotency-key') key: string) {
    return this.service.decide(actor(request), id, requestId, input, key, requestTraceId(request));
  }

  @Post(':requestId/cancel') @HttpCode(200) @ApiOkResponse({ type: SupplierEightDDeadlineResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:issues:read', organizationScope: { source: 'session', optional: true } })
  cancel(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() input: SupplierEightDDeadlineCancelDto, @Headers('idempotency-key') key: string) {
    return this.service.cancel(actor(request), id, requestId, input, key, requestTraceId(request));
  }
}

@Controller('api/v1/supplier-portal/eight-d/:id/deadline-extensions')
@ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierPortalEightDDeadlineController {
  constructor(private readonly service: SupplierEightDDeadlineService) {}

  @Get() @ApiOkResponse({ type: SupplierEightDDeadlineResultDto, isArray: true })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:read', organizationScope: { source: 'session', optional: true } })
  history(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.history(actor(request), id);
  }

  @Post() @ApiCreatedResponse({ type: SupplierEightDDeadlineResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:write', organizationScope: { source: 'session', optional: true } })
  request(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: SupplierEightDDeadlineRequestDto, @Headers('idempotency-key') key: string) {
    return this.service.request(actor(request), id, input, key, requestTraceId(request));
  }

  @Post(':requestId/cancel') @HttpCode(200) @ApiOkResponse({ type: SupplierEightDDeadlineResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:write', organizationScope: { source: 'session', optional: true } })
  cancel(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() input: SupplierEightDDeadlineCancelDto, @Headers('idempotency-key') key: string) {
    return this.service.cancel(actor(request), id, requestId, input, key, requestTraceId(request));
  }
}
