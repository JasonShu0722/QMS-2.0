import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ClosureInboxQueryDto, ClosureNotificationPageDto, ClosureTaskPageDto } from '../task-notification/closure-inbox.dto.js';
import { ClosureInboxService } from '../task-notification/closure-inbox.service.js';

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id };
}

@Controller('api/v1/tasks/closure')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class ClosureInboxController {
  constructor(private readonly inbox: ClosureInboxService) {}

  @Get()
  @RequireAccess({ featurePermission: 'task:read', featurePermissions: () => ['task:read', 'workflow:act'], organizationScope: { source: 'session', optional: true } })
  @ApiOkResponse({ type: ClosureTaskPageDto })
  list(@Query() query: ClosureInboxQueryDto, @Req() request: AuthorizedRequest) {
    return this.inbox.list(actor(request), query);
  }
}

@Controller('api/v1/notifications/closure')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class ClosureNotificationController {
  constructor(private readonly inbox: ClosureInboxService) {}

  @Get()
  @RequireAccess({ featurePermission: 'notification:read', featurePermissions: () => ['notification:read', 'workflow:act'], organizationScope: { source: 'session', optional: true } })
  @ApiOkResponse({ type: ClosureNotificationPageDto })
  list(@Query() query: ClosureInboxQueryDto, @Req() request: AuthorizedRequest) {
    return this.inbox.notifications(actor(request), query);
  }
}
