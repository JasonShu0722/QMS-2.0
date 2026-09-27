import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { SupplierIncomingService } from './supplier-incoming.service.js';
import { AttachIncomingPhotoDto, CompleteIncomingInspectionDto, CorrectIncomingInspectionDto, CreateIncomingInspectionDto, IncomingQueryDto, LinkIncomingProblemDto } from './supplier-incoming.dto.js';
import { READ_PERMISSION, WRITE_PERMISSION } from './supplier-incoming.rules.js';

function actor(request: Request) { const authorized = request as AuthorizedRequest; const session = authorized[AUTHENTICATED_SESSION]!; return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId }; }
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/supplier-incoming/inspections')
@ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierIncomingController {
  constructor(private readonly service: SupplierIncomingService) {}
  @Get() @ApiOkResponse() @RequireAccess({ featurePermission: READ_PERMISSION, organizationScope: queryScope }) list(@Req() request: Request, @Query() query: IncomingQueryDto) { return this.service.list(actor(request), query); }
  @Get(':id') @ApiOkResponse() @RequireAccess({ featurePermission: READ_PERMISSION, organizationScope: queryScope }) detail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query('organizationId') organizationId?: string) { return this.service.detail(actor(request), id, organizationId); }
  @Get(':id/source') @ApiOkResponse() @RequireAccess({ featurePermission: READ_PERMISSION, organizationScope: queryScope }) source(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) { return this.service.source(actor(request), id); }
  @Post() @ApiCreatedResponse() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: WRITE_PERMISSION, organizationScope: bodyScope }) create(@Req() request: Request, @Body() dto: CreateIncomingInspectionDto) { return this.service.create(actor(request), dto, requestTraceId(request), request.get('Idempotency-Key')); }
  @Put(':id/complete') @ApiOkResponse() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: WRITE_PERMISSION, organizationScope: queryScope }) complete(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteIncomingInspectionDto) { return this.service.complete(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }
  @Put(':id/correct') @ApiOkResponse() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: WRITE_PERMISSION, organizationScope: queryScope }) correct(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectIncomingInspectionDto) { return this.service.correct(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }
  @Post(':id/problem-links') @ApiCreatedResponse() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: WRITE_PERMISSION, organizationScope: queryScope }) linkProblem(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkIncomingProblemDto) { return this.service.linkProblem(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }
  @Post(':id/photos') @ApiCreatedResponse() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: WRITE_PERMISSION, organizationScope: bodyScope }) attachPhoto(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AttachIncomingPhotoDto) { return this.service.attachPhoto(actor(request), id, dto.fileId, dto.expectedVersion, requestTraceId(request), request.get('Idempotency-Key')); }
}
