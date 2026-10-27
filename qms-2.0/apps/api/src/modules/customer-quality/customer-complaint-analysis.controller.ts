import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { CustomerComplaintAnalysisService } from './customer-complaint-analysis.service.js';
import { AssignCustomerAnalysisDto, CustomerAnalysisCandidateDto, CustomerAnalysisCandidatesQueryDto, CustomerAnalysisDto, CustomerAnalysisHistoryDto, CustomerAnalysisScopeDto, CustomerAnalysisSummaryDto, CustomerFaeAnalysisTaskDto, SaveCustomerFaeAnalysisDto, SaveCustomerSupplierAnalysisDto, TransferCustomerAnalysisDto } from './customer-complaint-analysis.dto.js';

function actor(request: Request) { const authorized = request as AuthorizedRequest; const session = authorized[AUTHENTICATED_SESSION]!; return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId }; }
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/customer-quality/analysis')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class CustomerComplaintAnalysisController {
  constructor(private readonly service: CustomerComplaintAnalysisService) {}
  @Get('fae-tasks') @ApiOkResponse({ type: [CustomerFaeAnalysisTaskDto] })
  @RequireAccess({ featurePermission: 'customer-quality:analyses:fae', organizationScope: queryScope })
  tasks(@Req() request: Request, @Query() _query: CustomerAnalysisScopeDto) { return this.service.listFAETasks(actor(request)); }

  @Get('complaints/:id') @ApiOkResponse({ type: CustomerAnalysisSummaryDto })
  @RequireAccess({ featurePermission: 'customer-quality:complaints:read', organizationScope: queryScope })
  summary(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: CustomerAnalysisScopeDto) { return this.service.summary(actor(request), id); }

  @Get('complaints/:id/candidates/:section') @ApiOkResponse({ type: [CustomerAnalysisCandidateDto] })
  @RequireAccess({ featurePermission: 'customer-quality:complaints:read', organizationScope: queryScope })
  candidates(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Param('section') section: string, @Query() query: CustomerAnalysisCandidatesQueryDto) { return this.service.candidates(actor(request), id, section, query.recoverStale); }

  @Post('complaints/:id/assign/:section') @ApiCreatedResponse({ type: CustomerAnalysisDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'customer-quality:complaints:write', organizationScope: bodyScope })
  assign(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Param('section') section: string, @Body() dto: AssignCustomerAnalysisDto) { return this.service.assign(actor(request), id, section, dto, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get(':id/history') @ApiOkResponse({ type: [CustomerAnalysisHistoryDto] })
  @RequireAccess({ featurePermission: 'customer-quality:complaints:read', organizationScope: queryScope })
  history(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: CustomerAnalysisScopeDto) { return this.service.history(actor(request), id); }

  @Put(':id/fae') @ApiOkResponse({ type: CustomerAnalysisDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'customer-quality:analyses:fae', organizationScope: bodyScope })
  saveFae(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveCustomerFaeAnalysisDto) { return this.service.save(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key'), 'FAE'); }

  @Put(':id/supplier') @ApiOkResponse({ type: CustomerAnalysisDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'customer-quality:analyses:supplier', organizationScope: bodyScope })
  saveSupplier(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveCustomerSupplierAnalysisDto) { return this.service.save(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key'), 'SUPPLIER'); }

  @Post(':id/transfer') @ApiCreatedResponse({ type: CustomerAnalysisDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'customer-quality:analyses:fae', organizationScope: bodyScope })
  transfer(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferCustomerAnalysisDto) { return this.service.transfer(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }
}
