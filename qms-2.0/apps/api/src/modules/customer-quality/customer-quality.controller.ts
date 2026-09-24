import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { CustomerQualityService } from './customer-quality.service.js';
import { ArchiveComplaintDto, CreateComplaintDto, CreateCustomerDto, CustomerScopeDto, PhysicalAnalysisDto, PhysicalDispositionDto, UpdateComplaintDto, UpdateCustomerDto } from './customer-quality.dto.js';

function actor(request: Request) { const authorized = request as AuthorizedRequest; const session = authorized[AUTHENTICATED_SESSION]!; return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId }; }
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/customer-quality')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class CustomerQualityController {
  constructor(private readonly service: CustomerQualityService) {}
  @Get('customers') @ApiOkResponse() @RequireAccess({ featurePermission: 'customer-quality:complaints:read', organizationScope: queryScope }) customers(@Req() request: Request, @Query() _query: CustomerScopeDto) { return this.service.listCustomers(actor(request)); }
  @Post('customers') @ApiCreatedResponse() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'customer-quality:complaints:write', organizationScope: bodyScope }) createCustomer(@Req() request: Request, @Body() dto: CreateCustomerDto) { return this.service.createCustomer(actor(request), dto, requestTraceId(request), request.get('Idempotency-Key')); }
  @Put('customers/:id') @ApiOkResponse() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'customer-quality:complaints:write', organizationScope: bodyScope }) updateCustomer(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) { return this.service.updateCustomer(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }
  @Get('complaints') @ApiOkResponse() @RequireAccess({ featurePermission: 'customer-quality:complaints:read', organizationScope: queryScope }) complaints(@Req() request: Request) { return this.service.listComplaints(actor(request)); }
  @Get('complaints/:id') @ApiOkResponse() @RequireAccess({ featurePermission: 'customer-quality:complaints:read', organizationScope: queryScope }) complaint(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) { return this.service.detailComplaint(actor(request), id); }
  @Post('complaints') @ApiCreatedResponse() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'customer-quality:complaints:write', organizationScope: bodyScope }) createComplaint(@Req() request: Request, @Body() dto: CreateComplaintDto) { return this.service.createComplaint(actor(request), dto, requestTraceId(request), request.get('Idempotency-Key')); }
  @Put('complaints/:id') @ApiOkResponse() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'customer-quality:complaints:write', organizationScope: bodyScope }) updateComplaint(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateComplaintDto) { return this.service.updateComplaint(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }
  @Put('complaints/:id/archive') @ApiOkResponse() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'customer-quality:complaints:write', organizationScope: bodyScope }) archive(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ArchiveComplaintDto) { return this.service.archiveComplaint(actor(request), id, dto.expectedVersion, requestTraceId(request), request.get('Idempotency-Key')); }
  @Post('complaints/:id/disposition') @ApiCreatedResponse() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'customer-quality:complaints:write', organizationScope: bodyScope }) disposition(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PhysicalDispositionDto) { return this.service.recordPhysicalDisposition(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }
  @Post('complaints/:id/analysis') @ApiCreatedResponse() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'customer-quality:complaints:write', organizationScope: bodyScope }) analysis(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PhysicalAnalysisDto) { return this.service.recordPhysicalAnalysis(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }
}
