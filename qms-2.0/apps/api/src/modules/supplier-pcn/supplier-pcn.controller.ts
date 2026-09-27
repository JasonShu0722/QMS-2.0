import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { AdvanceSupplierPcnDto, CreateSupplierPcnDto, ReviewSupplierPcnDto, StartSupplierPcnWorkflowDto, SubmitSupplierPcnDto, SupplierPcnDetailDto, SupplierPcnDto, SupplierPcnPageDto, SupplierPcnProfilesDto, SupplierPcnQueryDto, UpdateSupplierPcnDto } from './supplier-pcn.dto.js';
import { SupplierPcnService } from './supplier-pcn.service.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}
const sessionScope = { source: 'session' } as const;
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;

@Controller('api/v1/supplier-pcn/requests')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierPcnController {
  constructor(private readonly service: SupplierPcnService) {}
  @Get() @ApiOkResponse({ type: SupplierPcnPageDto }) @RequireAccess({ featurePermission: 'supplier-pcn:requests:read', organizationScope: queryScope })
  list(@Req() request: Request, @Query() query: SupplierPcnQueryDto) { return this.service.list(actor(request), query); }
  @Get(':id') @ApiOkResponse({ type: SupplierPcnDetailDto }) @RequireAccess({ featurePermission: 'supplier-pcn:requests:read', organizationScope: queryScope })
  detail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query('organizationId') organizationId?: string) { return this.service.detail(actor(request), id, organizationId); }
  @Post(':id/start') @ApiCreatedResponse({ type: SupplierPcnDetailDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-pcn:requests:approve', organizationScope: sessionScope })
  start(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: StartSupplierPcnWorkflowDto) { return this.service.start(actor(request), id, input, requestTraceId(request), request.get('Idempotency-Key')); }
  @Post(':id/review') @ApiCreatedResponse({ type: SupplierPcnDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-pcn:requests:approve', organizationScope: sessionScope })
  review(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: ReviewSupplierPcnDto) { return this.service.review(actor(request), id, input, requestTraceId(request), request.get('Idempotency-Key')); }
}

@Controller('api/v1/supplier-portal/pcns')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierPcnPortalController {
  constructor(private readonly service: SupplierPcnService) {}
  @Get() @ApiOkResponse({ type: SupplierPcnPageDto }) @RequireAccess({ featurePermission: 'supplier-pcn:submissions:read', organizationScope: sessionScope })
  list(@Req() request: Request, @Query() query: SupplierPcnQueryDto) { return this.service.list(actor(request), query); }
  @Get('profiles') @ApiOkResponse({ type: SupplierPcnProfilesDto }) @RequireAccess({ featurePermission: 'supplier-pcn:submissions:read', organizationScope: sessionScope })
  profiles(@Req() request: Request) { return this.service.profiles(actor(request)); }
  @Get(':id') @ApiOkResponse({ type: SupplierPcnDetailDto }) @RequireAccess({ featurePermission: 'supplier-pcn:submissions:read', organizationScope: sessionScope })
  detail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) { return this.service.detail(actor(request), id); }
  @Post() @ApiCreatedResponse({ type: SupplierPcnDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-pcn:submissions:write', organizationScope: sessionScope })
  create(@Req() request: Request, @Body() input: CreateSupplierPcnDto) { return this.service.create(actor(request), input, requestTraceId(request), request.get('Idempotency-Key')); }
  @Post(':id/update') @ApiCreatedResponse({ type: SupplierPcnDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-pcn:submissions:write', organizationScope: sessionScope })
  update(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateSupplierPcnDto) { return this.service.update(actor(request), id, input, requestTraceId(request), request.get('Idempotency-Key')); }
  @Post(':id/submit') @ApiCreatedResponse({ type: SupplierPcnDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-pcn:submissions:write', organizationScope: sessionScope })
  submit(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: SubmitSupplierPcnDto) { return this.service.submit(actor(request), id, input, requestTraceId(request), request.get('Idempotency-Key')); }
  @Post(':id/advance') @ApiCreatedResponse({ type: SupplierPcnDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-pcn:submissions:write', organizationScope: sessionScope })
  advance(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: AdvanceSupplierPcnDto) { return this.service.advance(actor(request), id, input, requestTraceId(request), request.get('Idempotency-Key')); }
}
