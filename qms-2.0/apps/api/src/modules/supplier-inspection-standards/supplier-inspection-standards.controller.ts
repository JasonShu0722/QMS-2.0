import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { CreateSupplierInspectionStandardDto, CreateSupplierInspectionStandardItemDto, SupplierInspectionStandardDto, SupplierInspectionStandardItemDto, SupplierInspectionStandardPageDto, SupplierInspectionStandardQueryDto, SupplierInspectionStandardTransitionDto } from './supplier-inspection-standards.dto.js';
import { SupplierInspectionStandardsService } from './supplier-inspection-standards.service.js';
function actor(request: Request) { const authorized = request as AuthorizedRequest; const session = authorized[AUTHENTICATED_SESSION]!; return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId }; }
const sessionScope = { source: 'session' } as const; const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
@Controller('api/v1/supplier-inspection-standards') @ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierInspectionStandardsController {
  constructor(private readonly service: SupplierInspectionStandardsService) {}
  @Get() @ApiOkResponse({ type: SupplierInspectionStandardPageDto }) @RequireAccess({ featurePermission: 'supplier-inspection-standards:read', organizationScope: queryScope }) list(@Req() request: Request, @Query() query: SupplierInspectionStandardQueryDto) { return this.service.list(actor(request), query); }
  @Get(':id') @ApiOkResponse({ type: SupplierInspectionStandardDto }) @RequireAccess({ featurePermission: 'supplier-inspection-standards:read', organizationScope: sessionScope }) detail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) { return this.service.detail(actor(request), id); }
  @Post() @ApiCreatedResponse({ type: SupplierInspectionStandardDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'supplier-inspection-standards:write', organizationScope: sessionScope }) create(@Req() request: Request, @Body() input: CreateSupplierInspectionStandardDto, @Headers('idempotency-key') key?: string) { return this.service.create(actor(request), input, requestTraceId(request), key); }
  @Post(':id/items') @ApiCreatedResponse({ type: SupplierInspectionStandardItemDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'supplier-inspection-standards:write', organizationScope: sessionScope }) addItem(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: CreateSupplierInspectionStandardItemDto, @Headers('idempotency-key') key?: string) { return this.service.addItem(actor(request), id, input, requestTraceId(request), key); }
  @Post(':id/publish') @ApiOkResponse({ type: SupplierInspectionStandardDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'supplier-inspection-standards:publish', organizationScope: sessionScope }) publish(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: SupplierInspectionStandardTransitionDto, @Headers('idempotency-key') key?: string) { return this.service.publish(actor(request), id, input, requestTraceId(request), key); }
}
