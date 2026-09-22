import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { TaskService } from './task.service.js';
import { NotificationService } from './notification.service.js';
import { InboxMutationDto, InboxScopeDto, NotificationDto, NotificationPageDto, NotificationQueryDto, TaskDto, TaskPageDto, TaskQueryDto } from './task-inbox.dto.js';

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id };
}

@Controller('api/v1/tasks')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class TaskInboxController {
  constructor(private readonly tasks: TaskService) {}

  @Get()
  @RequireAccess({ featurePermission: 'task:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  @ApiOkResponse({ type: TaskPageDto })
  list(@Query() query: TaskQueryDto, @Req() request: AuthorizedRequest) {
    return this.tasks.list(actor(request), query);
  }

  @Post(':id/claim')
  @RequireAccess({ featurePermission: 'task:claim', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiResponse({ status: 201, type: TaskDto })
  claim(@Param('id', ParseUUIDPipe) id: string, @Query() _query: InboxScopeDto, @Body() body: InboxMutationDto, @Req() request: AuthorizedRequest) {
    return this.tasks.claim(actor(request), id, request.authorizedOrganizationId!, body.expectedVersion, requestTraceId(request));
  }

  @Post(':id/release')
  @RequireAccess({ featurePermission: 'task:claim', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiResponse({ status: 201, type: TaskDto })
  release(@Param('id', ParseUUIDPipe) id: string, @Query() _query: InboxScopeDto, @Body() body: InboxMutationDto, @Req() request: AuthorizedRequest) {
    return this.tasks.release(actor(request), id, request.authorizedOrganizationId!, body.expectedVersion, requestTraceId(request));
  }
}

@Controller('api/v1/notifications')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class NotificationInboxController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @RequireAccess({ featurePermission: 'notification:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  @ApiOkResponse({ type: NotificationPageDto })
  list(@Query() query: NotificationQueryDto, @Req() request: AuthorizedRequest) {
    return this.notifications.list(actor(request), query);
  }

  @Post(':id/read')
  @RequireAccess({ featurePermission: 'notification:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiResponse({ status: 201, type: NotificationDto })
  read(@Param('id', ParseUUIDPipe) id: string, @Query() _query: InboxScopeDto, @Body() body: InboxMutationDto, @Req() request: AuthorizedRequest) {
    return this.notifications.read(actor(request), id, request.authorizedOrganizationId!, body.expectedVersion, requestTraceId(request));
  }
}
