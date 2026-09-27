import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { CreateSupplierPerformanceAppealDto, CreateSupplierPerformanceCardDto, PublishSupplierPerformanceCardDto, SupplierPerformanceAppealDto, SupplierPerformanceAppealPageDto, SupplierPerformanceAppealTransitionDto, SupplierPerformanceCardDto, SupplierPerformancePageDto, SupplierPerformanceQueryDto } from './supplier-performance.dto.js';
import { SupplierPerformanceService } from './supplier-performance.service.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}

@Controller('api/v1/supplier-performance/cards')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierPerformanceController {
  constructor(private readonly service: SupplierPerformanceService) {}

  @Get() @ApiOkResponse({ type: SupplierPerformancePageDto })
  @RequireAccess({ featurePermission: 'supplier-performance:cards:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  list(@Req() request: Request, @Query() query: SupplierPerformanceQueryDto) { return this.service.list(actor(request), query); }

  @Post() @ApiCreatedResponse({ type: SupplierPerformanceCardDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-performance:cards:write', organizationScope: { source: 'body', field: 'organizationId', optional: true } })
  create(@Req() request: Request, @Body() input: CreateSupplierPerformanceCardDto, @Headers('idempotency-key') key?: string) {
    return this.service.create(actor(request), input, requestTraceId(request), key);
  }

  @Put(':id/publish') @ApiOkResponse({ type: SupplierPerformanceCardDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-performance:cards:publish', organizationScope: { source: 'body', field: 'organizationId', optional: true } })
  publish(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: PublishSupplierPerformanceCardDto, @Headers('idempotency-key') key?: string) {
    return this.service.publish(actor(request), id, input, requestTraceId(request), key);
  }
}

@Controller('api/v1/supplier-performance/appeals')
@ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierPerformanceAppealController {
  constructor(private readonly service: SupplierPerformanceService) {}
  @Get() @ApiOkResponse({ type: SupplierPerformanceAppealPageDto }) @RequireAccess({ featurePermission: 'supplier-performance:appeals:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  list(@Req() request: Request) { return this.service.listAppeals(actor(request)); }
  @Post() @ApiCreatedResponse({ type: SupplierPerformanceAppealDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'supplier-performance:appeals:write' })
  create(@Req() request: Request, @Body() input: CreateSupplierPerformanceAppealDto, @Headers('idempotency-key') key?: string) { return this.service.createAppeal(actor(request), input, requestTraceId(request), key); }
  @Put(':id/submit') @ApiOkResponse({ type: SupplierPerformanceAppealDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'supplier-performance:appeals:write' })
  submit(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: SupplierPerformanceAppealTransitionDto, @Headers('idempotency-key') key?: string) { return this.service.transitionAppeal(actor(request), id, input, 'SUBMITTED', requestTraceId(request), key); }
  @Put(':id/review') @ApiOkResponse({ type: SupplierPerformanceAppealDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'supplier-performance:appeals:review' })
  review(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: SupplierPerformanceAppealTransitionDto, @Headers('idempotency-key') key?: string) { return this.service.transitionAppeal(actor(request), id, input, input.decision ?? 'REJECTED', requestTraceId(request), key); }
}

const sessionScope = { source: 'session' } as const;

@Controller('api/v1/supplier-portal/performance/cards')
@ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierPerformancePortalCardController {
  constructor(private readonly service: SupplierPerformanceService) {}

  @Get() @ApiOkResponse({ type: SupplierPerformancePageDto })
  @RequireAccess({ featurePermission: 'supplier-performance:portal:cards:read', organizationScope: sessionScope })
  list(@Req() request: Request, @Query() query: SupplierPerformanceQueryDto) { return this.service.listPortal(actor(request), query); }
}

@Controller('api/v1/supplier-portal/performance/appeals')
@ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierPerformancePortalAppealController {
  constructor(private readonly service: SupplierPerformanceService) {}

  @Get() @ApiOkResponse({ type: SupplierPerformanceAppealPageDto })
  @RequireAccess({ featurePermission: 'supplier-performance:portal:appeals:read', organizationScope: sessionScope })
  list(@Req() request: Request) { return this.service.listAppeals(actor(request), true); }

  @Post() @ApiCreatedResponse({ type: SupplierPerformanceAppealDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-performance:portal:appeals:write', organizationScope: sessionScope })
  create(@Req() request: Request, @Body() input: CreateSupplierPerformanceAppealDto, @Headers('idempotency-key') key?: string) { return this.service.createAppeal(actor(request), input, requestTraceId(request), key, true); }

  @Put(':id/submit') @ApiOkResponse({ type: SupplierPerformanceAppealDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-performance:portal:appeals:write', organizationScope: sessionScope })
  submit(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: SupplierPerformanceAppealTransitionDto, @Headers('idempotency-key') key?: string) { return this.service.transitionAppeal(actor(request), id, input, 'SUBMITTED', requestTraceId(request), key, true); }
}
