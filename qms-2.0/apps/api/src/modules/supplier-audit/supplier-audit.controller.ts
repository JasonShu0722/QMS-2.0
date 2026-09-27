import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { CloseSupplierAuditRecordDto, CreateSupplierAuditPlanDto, CreateSupplierAuditRecordDto, SupplierAuditChecklistDto, SupplierAuditPlanDto, SupplierAuditPlanPageDto, SupplierAuditQueryDto, SupplierAuditRecordDto, SupplierAuditRecordPageDto, SupplierAuditTransitionDto, UpdateSupplierAuditChecklistDto } from './supplier-audit.dto.js';
import { SupplierAuditService } from './supplier-audit.service.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}

const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const sessionScope = { source: 'session' } as const;

@Controller('api/v1/supplier-audit')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierAuditController {
  constructor(private readonly service: SupplierAuditService) {}

  @Get('plans') @ApiOkResponse({ type: SupplierAuditPlanPageDto })
  @RequireAccess({ featurePermission: 'supplier-audit:plans:read', organizationScope: queryScope })
  listPlans(@Req() request: Request, @Query() query: SupplierAuditQueryDto) { return this.service.listPlans(actor(request), query); }

  @Post('plans') @ApiCreatedResponse({ type: SupplierAuditPlanDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-audit:plans:write', organizationScope: sessionScope })
  createPlan(@Req() request: Request, @Body() input: CreateSupplierAuditPlanDto, @Headers('idempotency-key') key?: string) { return this.service.createPlan(actor(request), input, requestTraceId(request), key); }

  @Put('plans/:id/submit') @ApiOkResponse({ type: SupplierAuditPlanDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-audit:plans:write', organizationScope: sessionScope })
  submitPlan(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: SupplierAuditTransitionDto, @Headers('idempotency-key') key?: string) { return this.service.submitPlan(actor(request), id, input, requestTraceId(request), key); }

  @Get('records') @ApiOkResponse({ type: SupplierAuditRecordPageDto })
  @RequireAccess({ featurePermission: 'supplier-audit:records:read', organizationScope: queryScope })
  listRecords(@Req() request: Request, @Query() query: SupplierAuditQueryDto) { return this.service.listRecords(actor(request), query); }

  @Post('records') @ApiCreatedResponse({ type: SupplierAuditRecordDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-audit:records:write', organizationScope: sessionScope })
  createRecord(@Req() request: Request, @Body() input: CreateSupplierAuditRecordDto, @Headers('idempotency-key') key?: string) { return this.service.createRecord(actor(request), input, requestTraceId(request), key); }

  @Get('records/:id/checklist') @ApiOkResponse({ type: SupplierAuditChecklistDto })
  @RequireAccess({ featurePermission: 'supplier-audit:records:read', organizationScope: sessionScope })
  getChecklist(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) { return this.service.getChecklist(actor(request), id); }

  @Put('records/:id/checklist') @ApiOkResponse({ type: SupplierAuditChecklistDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-audit:records:write', organizationScope: sessionScope })
  updateChecklist(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateSupplierAuditChecklistDto, @Headers('idempotency-key') key?: string) { return this.service.updateChecklist(actor(request), id, input, requestTraceId(request), key); }

  @Put('records/:id/submit') @ApiOkResponse({ type: SupplierAuditRecordDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-audit:records:write', organizationScope: sessionScope })
  submitRecord(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: SupplierAuditTransitionDto, @Headers('idempotency-key') key?: string) { return this.service.submitRecord(actor(request), id, input, requestTraceId(request), key); }

  @Put('records/:id/close') @ApiOkResponse({ type: SupplierAuditRecordDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-audit:records:close', organizationScope: sessionScope })
  closeRecord(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: CloseSupplierAuditRecordDto, @Headers('idempotency-key') key?: string) { return this.service.closeRecord(actor(request), id, input, requestTraceId(request), key); }
}
