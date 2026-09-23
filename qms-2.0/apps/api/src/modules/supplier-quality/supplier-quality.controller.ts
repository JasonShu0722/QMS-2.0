import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { SupplierQualityService } from './supplier-quality.service.js';
import { CreateSupplierProfileDto, IssueSupplierProblemDto, SaveSupplierResponseDraftDto, SubmitSupplierResponseDto, SupplierDirectoryQueryDto, SupplierProblemDetailQueryDto, SupplierProblemDto, SupplierProblemDraftDto, SupplierProblemPageDto, SupplierProblemQueryDto, SupplierProfileDto, SupplierProfilePageDto, SupplierReferenceQueryDto, SupplierReferenceOptionsDto, SupplierScopeQueryDto, SupplierWorkflowActionDto, UpdateSupplierProblemDraftDto, UpdateSupplierProfileDto } from './supplier-quality.dto.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}

const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/supplier-quality')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierQualityController {
  constructor(private readonly service: SupplierQualityService) {}

  @Get('profiles') @ApiOkResponse({ type: SupplierProfilePageDto })
  @RequireAccess({ featurePermission: 'supplier-quality:profiles:read', organizationScope: queryScope })
  profiles(@Req() request: Request, @Query() query: SupplierScopeQueryDto) { return this.service.profiles(actor(request), query); }

  @Get('profiles/:id') @ApiOkResponse({ type: SupplierProfileDto })
  @RequireAccess({ featurePermission: 'supplier-quality:profiles:read', organizationScope: queryScope })
  profile(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: SupplierScopeQueryDto) { return this.service.profile(actor(request), id); }

  @Put('profiles/:id') @ApiOkResponse({ type: SupplierProfileDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:profiles:write', organizationScope: bodyScope })
  updateProfile(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierProfileDto) { return this.service.updateProfile(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get('supplier-options') @ApiOkResponse({ type: SupplierReferenceOptionsDto })
  @RequireAccess({ featurePermission: 'supplier-quality:profiles:write', organizationScope: queryScope })
  supplierOptions(@Req() request: Request, @Query() query: SupplierDirectoryQueryDto) { return this.service.supplierOptions(actor(request), query); }

  @Get('reference-options') @ApiOkResponse({ type: SupplierReferenceOptionsDto })
  @RequireAccess({ featurePermission: 'supplier-quality:problems:write', organizationScope: queryScope })
  options(@Req() request: Request, @Query() query: SupplierReferenceQueryDto) { return this.service.options(actor(request), query); }

  @Post('profiles') @ApiCreatedResponse({ type: SupplierProfileDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:profiles:write', organizationScope: bodyScope })
  createProfile(@Req() request: Request, @Body() dto: CreateSupplierProfileDto) { return this.service.createProfile(actor(request), dto, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get('problems') @ApiOkResponse({ type: SupplierProblemPageDto })
  @RequireAccess({ featurePermission: 'supplier-quality:problems:read', organizationScope: queryScope })
  list(@Req() request: Request, @Query() query: SupplierProblemQueryDto) { return this.service.list(actor(request), query, false); }

  @Get('problems/:id') @ApiOkResponse({ type: SupplierProblemDto })
  @RequireAccess({ featurePermission: 'supplier-quality:problems:read', organizationScope: queryScope })
  detail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() query: SupplierProblemDetailQueryDto) { return this.service.detail(actor(request), id, false, query); }

  @Post('drafts') @ApiCreatedResponse({ type: SupplierProblemDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:problems:write', organizationScope: bodyScope })
  create(@Req() request: Request, @Body() dto: SupplierProblemDraftDto) { return this.service.createDraft(actor(request), dto, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put('drafts/:id') @ApiOkResponse({ type: SupplierProblemDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:problems:write', organizationScope: bodyScope })
  update(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierProblemDraftDto) { return this.service.updateDraft(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post('drafts/:id/issue') @ApiCreatedResponse({ type: SupplierProblemDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:problems:write', organizationScope: queryScope })
  issue(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IssueSupplierProblemDto) { return this.service.issueDraft(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put('problems/:id/response-draft') @ApiOkResponse({ type: SupplierProblemDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:write', organizationScope: queryScope })
  response(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveSupplierResponseDraftDto, @Query() _query: SupplierScopeQueryDto) { return this.service.saveResponse(actor(request), id, dto, requestTraceId(request), false, request.get('Idempotency-Key')); }

  @Post('problems/:id/actions') @ApiCreatedResponse({ type: SupplierProblemDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:write', organizationScope: queryScope })
  action(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitSupplierResponseDto) { return this.service.submitResponse(actor(request), id, dto, requestTraceId(request), false, request.get('Idempotency-Key')); }

  @Post('problems/:id/workflow-actions') @ApiOkResponse({ type: SupplierProblemDto })
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:problems:write', organizationScope: queryScope })
  workflowAction(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupplierWorkflowActionDto) { return this.service.submitWorkflowAction(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }
}

@Controller('api/v1/supplier-portal')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierPortalController {
  constructor(private readonly service: SupplierQualityService) {}

  @Get('problems') @ApiOkResponse({ type: SupplierProblemPageDto })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:read', organizationScope: queryScope })
  list(@Req() request: Request, @Query() query: SupplierProblemQueryDto) { return this.service.list(actor(request), query, true); }

  @Get('problems/:id') @ApiOkResponse({ type: SupplierProblemDto })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:read', organizationScope: queryScope })
  detail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() query: SupplierProblemDetailQueryDto) { return this.service.detail(actor(request), id, true, query); }

  @Put('problems/:id/response-draft') @ApiOkResponse({ type: SupplierProblemDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:write', organizationScope: queryScope })
  response(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveSupplierResponseDraftDto, @Query() _query: SupplierScopeQueryDto) { return this.service.saveResponse(actor(request), id, dto, requestTraceId(request), true, request.get('Idempotency-Key')); }

  @Post('problems/:id/actions') @ApiCreatedResponse({ type: SupplierProblemDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:write', organizationScope: queryScope })
  action(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitSupplierResponseDto) { return this.service.submitResponse(actor(request), id, dto, requestTraceId(request), true, request.get('Idempotency-Key')); }
}
