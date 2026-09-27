import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { CoordinateInspectionService } from './coordinate-inspection.service.js';
import { ApproveCoordinateInspectionDto, CoordinateInspectionPageDto, CoordinateInspectionQueryDto, CoordinateInspectionRequestDto, CreateCoordinateInspectionDto, ProgressCoordinateInspectionDto, ScheduleCoordinateInspectionDto, SubmitCoordinateInspectionDto, UpdateCoordinateInspectionDto } from './coordinate-inspection.dto.js';
import { APPROVE_PERMISSION, READ_PERMISSION, SCHEDULE_PERMISSION, WRITE_PERMISSION } from './coordinate-inspection.rules.js';

function actor(request: Request) { const authorized = request as AuthorizedRequest; const session = authorized[AUTHENTICATED_SESSION]!; return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId }; }
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/coordinate-inspection')
@ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class CoordinateInspectionController {
  constructor(private readonly service: CoordinateInspectionService) {}
  @Get('requests') @ApiOkResponse({ type: CoordinateInspectionPageDto }) @RequireAccess({ featurePermission: READ_PERMISSION, organizationScope: queryScope }) list(@Req() request: Request, @Query() query: CoordinateInspectionQueryDto) { return this.service.list(actor(request), query); }
  @Get('requests/:id') @ApiOkResponse({ type: CoordinateInspectionRequestDto }) @RequireAccess({ featurePermission: READ_PERMISSION, organizationScope: queryScope }) detail(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) { return this.service.detail(actor(request), id); }
  @Post('requests') @ApiCreatedResponse({ type: CoordinateInspectionRequestDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: WRITE_PERMISSION, organizationScope: bodyScope }) create(@Req() request: Request, @Body() body: CreateCoordinateInspectionDto, @Headers('idempotency-key') key?: string) { return this.service.create(actor(request), body, requestTraceId(request), key); }
  @Put('requests/:id') @ApiOkResponse({ type: CoordinateInspectionRequestDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: WRITE_PERMISSION, organizationScope: bodyScope }) revise(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateCoordinateInspectionDto, @Headers('idempotency-key') key?: string) { return this.service.revise(actor(request), id, body, requestTraceId(request), key); }
  @Put('requests/:id/submit') @ApiOkResponse({ type: CoordinateInspectionRequestDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: WRITE_PERMISSION, organizationScope: queryScope }) submit(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: SubmitCoordinateInspectionDto, @Headers('idempotency-key') key?: string) { return this.service.submit(actor(request), id, body, requestTraceId(request), key); }
  @Put('requests/:id/approve') @ApiOkResponse({ type: CoordinateInspectionRequestDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: APPROVE_PERMISSION, organizationScope: queryScope }) approve(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApproveCoordinateInspectionDto, @Headers('idempotency-key') key?: string) { return this.service.approve(actor(request), id, body, requestTraceId(request), key); }
  @Put('requests/:id/schedule') @ApiOkResponse({ type: CoordinateInspectionRequestDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: SCHEDULE_PERMISSION, organizationScope: queryScope }) schedule(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ScheduleCoordinateInspectionDto, @Headers('idempotency-key') key?: string) { return this.service.schedule(actor(request), id, body, requestTraceId(request), key); }
  @Put('requests/:id/progress') @ApiOkResponse({ type: CoordinateInspectionRequestDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: WRITE_PERMISSION, organizationScope: queryScope }) progress(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ProgressCoordinateInspectionDto, @Headers('idempotency-key') key?: string) { return this.service.progress(actor(request), id, body, requestTraceId(request), key); }
}
