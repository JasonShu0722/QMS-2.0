import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { InboxMutationDto } from './task-inbox.dto.js';
import { SupplierPortalNotificationDto, SupplierPortalNotificationPageDto, SupplierPortalNotificationQueryDto } from './supplier-portal-notification.dto.js';
import { SupplierPortalNotificationService } from './supplier-portal-notification.service.js';

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id };
}

@Controller('api/v1/supplier-portal/notifications')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierPortalNotificationController {
  constructor(private readonly notifications: SupplierPortalNotificationService) {}

  @Get()
  @RequireAccess({ featurePermission: 'notification:read', organizationScope: { source: 'session' } })
  @ApiOkResponse({ type: SupplierPortalNotificationPageDto })
  list(@Req() request: AuthorizedRequest, @Query() query: SupplierPortalNotificationQueryDto) {
    return this.notifications.list(actor(request), query);
  }

  @Post(':id/read')
  @RequireAccess({ featurePermission: 'notification:read', organizationScope: { source: 'session' } })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiResponse({ status: 201, type: SupplierPortalNotificationDto })
  read(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: InboxMutationDto) {
    return this.notifications.read(actor(request), id, body.expectedVersion, requestTraceId(request));
  }
}
