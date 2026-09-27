import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { CreateSupplierAdmissionDocumentDto, ReviewSupplierAdmissionDocumentDto, SubmitSupplierAdmissionDocumentDto, SupplierAdmissionDetailDto, SupplierAdmissionDocumentDto, SupplierAdmissionPageDto, SupplierAdmissionQueryDto } from './supplier-admission.dto.js';
import { SupplierAdmissionService } from './supplier-admission.service.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}

const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const sessionScope = { source: 'session' } as const;

@Controller('api/v1/supplier-admission/quality-documents')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierAdmissionController {
  constructor(private readonly service: SupplierAdmissionService) {}

  @Get() @ApiOkResponse({ type: SupplierAdmissionPageDto })
  @RequireAccess({ featurePermission: 'supplier-admission:documents:read', organizationScope: queryScope })
  list(@Req() request: Request, @Query() query: SupplierAdmissionQueryDto) { return this.service.list(actor(request), query); }

  @Get(':id') @ApiOkResponse({ type: SupplierAdmissionDetailDto })
  @RequireAccess({ featurePermission: 'supplier-admission:documents:read', organizationScope: queryScope })
  detail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query('organizationId') organizationId?: string) { return this.service.detail(actor(request), id, organizationId); }

  @Post(':id/review') @ApiCreatedResponse({ type: SupplierAdmissionDocumentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-admission:documents:review', organizationScope: sessionScope })
  review(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: ReviewSupplierAdmissionDocumentDto) { return this.service.review(actor(request), id, input, requestTraceId(request), request.get('Idempotency-Key')); }
}

@Controller('api/v1/supplier-portal/quality-documents')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierAdmissionPortalController {
  constructor(private readonly service: SupplierAdmissionService) {}

  @Get() @ApiOkResponse({ type: SupplierAdmissionPageDto })
  @RequireAccess({ featurePermission: 'supplier-admission:submissions:read', organizationScope: sessionScope })
  list(@Req() request: Request, @Query() query: SupplierAdmissionQueryDto) { return this.service.list(actor(request), query); }

  @Get(':id') @ApiOkResponse({ type: SupplierAdmissionDetailDto })
  @RequireAccess({ featurePermission: 'supplier-admission:submissions:read', organizationScope: sessionScope })
  detail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) { return this.service.detail(actor(request), id); }

  @Post() @ApiCreatedResponse({ type: SupplierAdmissionDocumentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-admission:submissions:write', organizationScope: sessionScope })
  create(@Req() request: Request, @Body() input: CreateSupplierAdmissionDocumentDto) { return this.service.create(actor(request), input, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post(':id/submit') @ApiCreatedResponse({ type: SupplierAdmissionDocumentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-admission:submissions:write', organizationScope: sessionScope })
  submit(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: SubmitSupplierAdmissionDocumentDto) { return this.service.submit(actor(request), id, input, requestTraceId(request), request.get('Idempotency-Key')); }
}
