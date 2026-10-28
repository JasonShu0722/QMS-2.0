import { Body, Controller, Delete, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { AdminUserLifecycleService } from './admin-user-lifecycle.service.js';
import { AdminUserForceDeleteResultDto, AdminUserLifecycleQueryDto, DeleteAdminUserDto } from './admin-user-lifecycle.dto.js';

@Controller('api/v1/admin/users')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class AdminUserLifecycleController {
  constructor(private readonly lifecycle: AdminUserLifecycleService) {}

  @Delete(':userId')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: AdminUserForceDeleteResultDto })
  @RequireAuthenticated()
  deleteUser(@Param('userId', ParseUUIDPipe) userId: string, @Query() query: AdminUserLifecycleQueryDto, @Body() dto: DeleteAdminUserDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.set('Cache-Control', 'no-store');
    const authorized = request as AuthorizedRequest;
    const session = authorized[AUTHENTICATED_SESSION];
    if (!session) throw new Error('Authenticated session guard did not attach a session');
    const actor = { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
    return this.lifecycle.deleteUser(actor, userId, dto, query.organizationId ?? session.user.organizationId, requestTraceId(request), request.get('Idempotency-Key'));
  }
}
