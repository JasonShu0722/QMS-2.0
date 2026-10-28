import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { SupplierEightDTaskService } from './supplier-eight-d-task.service.js';
import { SupplierEightDTaskPageDto, SupplierEightDNotificationPageDto, SupplierEightDTaskQueryDto } from './supplier-eight-d-task.dto.js';

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: request.authorizedOrganizationId };
}

// Fixed inbox routes precede the existing :id route when the parent registers controllers.
@Controller('api/v1/supplier-quality/eight-d')
@ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierEightDTaskController {
  constructor(private readonly tasks: SupplierEightDTaskService) {}

  @Get('tasks') @ApiOkResponse({ type: SupplierEightDTaskPageDto })
  @RequireAccess({ featurePermission: 'task:read', organizationScope: { source: 'session', optional: true } })
  list(@Req() request: AuthorizedRequest, @Query() query: SupplierEightDTaskQueryDto) { return this.tasks.list(actor(request), query); }

  @Get('notifications') @ApiOkResponse({ type: SupplierEightDNotificationPageDto })
  @RequireAccess({ featurePermission: 'notification:read', organizationScope: { source: 'session', optional: true } })
  notifications(@Req() request: AuthorizedRequest, @Query() query: SupplierEightDTaskQueryDto) { return this.tasks.notifications(actor(request), query); }
}

@Controller('api/v1/supplier-portal/eight-d')
@ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierPortalEightDTaskController extends SupplierEightDTaskController {
  @Get('tasks') @ApiOkResponse({ type: SupplierEightDTaskPageDto })
  @RequireAccess({ featurePermission: 'supplier-quality:responses:read', organizationScope: { source: 'session', optional: true } })
  override list(@Req() request: AuthorizedRequest, @Query() query: SupplierEightDTaskQueryDto) { return super.list(request, query); }
}
