import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ProcessEightDTaskService } from './process-eight-d-task.service.js';
import { ProcessEightDNotificationPageDto, ProcessEightDTaskPageDto, ProcessEightDTaskQueryDto } from './process-eight-d-task.dto.js';

function actor(request: AuthorizedRequest) { const s = request[AUTHENTICATED_SESSION]!; return { ...s.user, sessionId: s.id }; }

@Controller('api/v1/process-quality/eight-d')
@ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class ProcessEightDTaskController {
  constructor(private readonly tasks: ProcessEightDTaskService) {}
  @Get('tasks') @ApiOkResponse({ type: ProcessEightDTaskPageDto })
  @RequireAccess({ featurePermission: 'task:read', organizationScope: { source: 'session', optional: true } })
  list(@Query() query: ProcessEightDTaskQueryDto, @Req() request: AuthorizedRequest) { return this.tasks.list(actor(request), query); }
  @Get('notifications') @ApiOkResponse({ type: ProcessEightDNotificationPageDto })
  @RequireAccess({ featurePermission: 'notification:read', organizationScope: { source: 'session', optional: true } })
  notifications(@Query() query: ProcessEightDTaskQueryDto, @Req() request: AuthorizedRequest) { return this.tasks.notifications(actor(request), query); }
}
