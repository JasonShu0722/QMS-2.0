import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { CustomerComplaintLedgerService } from './customer-complaint-ledger.service.js';
import { CustomerLedgerCandidatesDto, CustomerLedgerCreateDto, CustomerLedgerDetailDto, CustomerLedgerImportDto,
  CustomerLedgerImportResultDto, CustomerLedgerItemDto, CustomerLedgerListDto, CustomerLedgerNoteDto,
  CustomerLedgerPageDto, CustomerLedgerReceivingDto, CustomerLedgerReassignDto, CustomerLedgerScopeDto, CustomerLedgerUpdateDto } from './customer-complaint-ledger.dto.js';
import { LEDGER_PERMISSIONS } from './customer-complaint-ledger.types.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import { FileDto } from '../file-management/file.dto.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/customer-quality/ledger')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class CustomerComplaintLedgerController {
  constructor(private readonly service: CustomerComplaintLedgerService, private readonly files: FileLifecycleService) {}

  @Get('') @ApiOkResponse({ type: CustomerLedgerPageDto })
  @RequireAccess({ featurePermission: LEDGER_PERMISSIONS.read, organizationScope: queryScope })
  list(@Req() request: Request, @Query() dto: CustomerLedgerListDto) { return this.service.list(actor(request), dto); }

  @Get('candidates') @ApiOkResponse({ type: CustomerLedgerCandidatesDto })
  @RequireAccess({ featurePermission: LEDGER_PERMISSIONS.read, organizationScope: queryScope })
  candidates(@Req() request: Request, @Query() dto: CustomerLedgerListDto) { return this.service.candidates(actor(request), dto); }

  @Post('import/preview') @ApiCreatedResponse({ type: CustomerLedgerImportResultDto }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: LEDGER_PERMISSIONS.write, organizationScope: bodyScope })
  preview(@Req() request: Request, @Body() dto: CustomerLedgerImportDto) { return this.service.preview(actor(request), dto); }

  @Post('import/commit') @ApiCreatedResponse({ type: CustomerLedgerImportResultDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: LEDGER_PERMISSIONS.write, organizationScope: bodyScope })
  commit(@Req() request: Request, @Body() dto: CustomerLedgerImportDto) { return this.service.commit(actor(request), dto, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get(':id') @ApiOkResponse({ type: CustomerLedgerDetailDto })
  @RequireAccess({ featurePermission: LEDGER_PERMISSIONS.read, organizationScope: queryScope })
  detail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: CustomerLedgerScopeDto) { return this.service.detail(actor(request), id); }

  @Get(':id/attachments') @ApiOkResponse({ type: [FileDto] })
  @RequireAccess({ featurePermission: LEDGER_PERMISSIONS.read, organizationScope: queryScope })
  async attachments(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: CustomerLedgerScopeDto) {
    const currentActor = actor(request);
    await this.service.detail(currentActor, id);
    return this.files.listResource(currentActor, { resourceType: 'CustomerComplaint', resourceId: id });
  }

  @Post('') @ApiCreatedResponse({ type: CustomerLedgerItemDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: LEDGER_PERMISSIONS.write, organizationScope: bodyScope })
  create(@Req() request: Request, @Body() dto: CustomerLedgerCreateDto) { return this.service.create(actor(request), dto, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put(':id') @ApiOkResponse({ type: CustomerLedgerItemDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: LEDGER_PERMISSIONS.write, organizationScope: bodyScope })
  update(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustomerLedgerUpdateDto) { return this.service.update(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post(':id/reassign') @ApiCreatedResponse({ type: CustomerLedgerItemDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: LEDGER_PERMISSIONS.reassign, organizationScope: bodyScope })
  reassign(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustomerLedgerReassignDto) { return this.service.reassign(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put(':id/receiving') @ApiOkResponse({ type: CustomerLedgerItemDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: LEDGER_PERMISSIONS.write, organizationScope: bodyScope })
  receiving(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustomerLedgerReceivingDto) { return this.service.receiving(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post(':id/close') @ApiCreatedResponse({ type: CustomerLedgerItemDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: LEDGER_PERMISSIONS.close, organizationScope: bodyScope })
  close(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustomerLedgerNoteDto) { return this.service.close(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post(':id/reopen') @ApiCreatedResponse({ type: CustomerLedgerItemDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: LEDGER_PERMISSIONS.close, organizationScope: bodyScope })
  reopen(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustomerLedgerNoteDto) { return this.service.reopen(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }
}
