import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { AnnouncementService } from './announcement.service.js';
import { AnnouncementAudienceUsersDto, AnnouncementInputDto, AnnouncementManagePageDto, AnnouncementMinePageDto, AnnouncementReadDto, AnnouncementReceiptDto, AnnouncementResponseDto, AnnouncementScopeDto, AnnouncementVersionDto, ManageAnnouncementsQueryDto, MineAnnouncementsQueryDto, UpdateAnnouncementDto } from './announcement.dto.js';

function actor(request: Request) { const authorized = request as AuthorizedRequest; const session = authorized[AUTHENTICATED_SESSION]!; return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId }; }
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/announcements')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class AnnouncementController {
  constructor(private readonly service: AnnouncementService) {}

  @Get('mine') @ApiOkResponse({ type: AnnouncementMinePageDto }) @RequireAccess({ featurePermission: 'announcement:read', organizationScope: queryScope })
  mine(@Req() request: Request, @Query() query: MineAnnouncementsQueryDto) { return this.service.mine(actor(request), query.unreadOnly === 'true'); }

  @Get('manage') @ApiOkResponse({ type: AnnouncementManagePageDto }) @RequireAccess({ featurePermission: 'announcement:manage', organizationScope: queryScope })
  manage(@Req() request: Request, @Query() query: ManageAnnouncementsQueryDto) { return this.service.manage(actor(request), query.page, query.pageSize); }

  @Get('audience-users') @ApiOkResponse({ type: AnnouncementAudienceUsersDto }) @RequireAccess({ featurePermission: 'announcement:manage', organizationScope: queryScope })
  audienceUsers(@Req() request: Request, @Query() _query: AnnouncementScopeDto) { return this.service.audienceUsers(actor(request)); }

  @Get(':id/receipts') @ApiOkResponse({ type: [AnnouncementReceiptDto] }) @RequireAccess({ featurePermission: 'announcement:audit:read', organizationScope: queryScope })
  receipts(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: AnnouncementScopeDto) { return this.service.receipts(actor(request), id); }

  @Post() @ApiCreatedResponse({ type: AnnouncementResponseDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'announcement:manage', organizationScope: bodyScope })
  create(@Req() request: Request, @Body() body: AnnouncementInputDto, @Headers('idempotency-key') key?: string) { return this.service.create(actor(request), body, requestTraceId(request), key); }

  @Put(':id') @ApiOkResponse({ type: AnnouncementResponseDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'announcement:manage', organizationScope: bodyScope })
  update(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateAnnouncementDto, @Headers('idempotency-key') key?: string) { return this.service.update(actor(request), id, body.expectedVersion, body, requestTraceId(request), key); }

  @Post(':id/publish') @ApiCreatedResponse({ type: AnnouncementResponseDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'announcement:manage', organizationScope: queryScope })
  publish(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: AnnouncementScopeDto, @Body() body: AnnouncementVersionDto, @Headers('idempotency-key') key?: string) { return this.service.publish(actor(request), id, body.expectedVersion, requestTraceId(request), key); }

  @Post(':id/archive') @ApiCreatedResponse({ type: AnnouncementResponseDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'announcement:manage', organizationScope: queryScope })
  archive(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: AnnouncementScopeDto, @Body() body: AnnouncementVersionDto, @Headers('idempotency-key') key?: string) { return this.service.archive(actor(request), id, body.expectedVersion, requestTraceId(request), key); }

  @Post(':id/read') @ApiCreatedResponse({ type: AnnouncementReadDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'announcement:read', organizationScope: queryScope })
  read(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: AnnouncementScopeDto, @Headers('idempotency-key') key?: string) { return this.service.markRead(actor(request), id, requestTraceId(request), key); }
}
