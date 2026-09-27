import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ConcessionDetailDto, ConcessionPageDto, ConcessionQueryDto, ConcessionRecordDto, ConcessionVersionDto, CreateConcessionDto, DecideConcessionDto } from './supplier-concession.dto.js';
import { CONCESSION_PERMISSIONS } from './supplier-concession.rules.js';
import { SupplierConcessionService } from './supplier-concession.service.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}

const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/supplier-concessions')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierConcessionController {
  constructor(private readonly service: SupplierConcessionService) {}

  @Get() @ApiOkResponse({ type: ConcessionPageDto })
  @RequireAccess({ featurePermission: CONCESSION_PERMISSIONS.read, organizationScope: queryScope })
  list(@Req() request: Request, @Query() query: ConcessionQueryDto) { return this.service.list(actor(request), query); }

  @Get(':id') @ApiOkResponse({ type: ConcessionDetailDto })
  @RequireAccess({ featurePermission: CONCESSION_PERMISSIONS.read, organizationScope: queryScope })
  detail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query('organizationId') organizationId?: string) { return this.service.detail(actor(request), id, organizationId); }

  @Post() @ApiCreatedResponse({ type: ConcessionRecordDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: CONCESSION_PERMISSIONS.write, organizationScope: bodyScope })
  create(@Req() request: Request, @Body() input: CreateConcessionDto) { return this.service.create(actor(request), input, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post(':id/submit') @ApiCreatedResponse({ type: ConcessionRecordDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: CONCESSION_PERMISSIONS.write, organizationScope: { source: 'session' } })
  submit(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: ConcessionVersionDto) { return this.service.submit(actor(request), id, input, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post(':id/withdraw') @ApiCreatedResponse({ type: ConcessionRecordDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: CONCESSION_PERMISSIONS.write, organizationScope: { source: 'session' } })
  withdraw(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: ConcessionVersionDto) { return this.service.withdraw(actor(request), id, input, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post(':id/approve') @ApiCreatedResponse({ type: ConcessionRecordDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: CONCESSION_PERMISSIONS.approve, organizationScope: { source: 'session' } })
  approve(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: DecideConcessionDto) { return this.service.decide(actor(request), id, input, true, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post(':id/reject') @ApiCreatedResponse({ type: ConcessionRecordDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: CONCESSION_PERMISSIONS.approve, organizationScope: { source: 'session' } })
  reject(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: DecideConcessionDto) { return this.service.decide(actor(request), id, input, false, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post(':id/release') @ApiCreatedResponse({ type: ConcessionRecordDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: CONCESSION_PERMISSIONS.release, organizationScope: { source: 'session' } })
  release(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: DecideConcessionDto) { return this.service.release(actor(request), id, input, requestTraceId(request), request.get('Idempotency-Key')); }
}
