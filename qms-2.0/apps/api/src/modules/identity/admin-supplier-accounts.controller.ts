import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { adminError } from '../../common/security/admin-mutation.service.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { AdminUserForceDeleteResultDto, DeleteAdminUserDto } from './admin-user-lifecycle.dto.js';
import { AdminSupplierAccountsPageDto, AdminSupplierAccountsQueryDto, AdminSupplierAccountTargetDto } from './admin-supplier-accounts.dto.js';
import { AdminSupplierAccountsService } from './admin-supplier-accounts.service.js';

@Controller('api/v1/admin/supplier-accounts')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
@RequireAuthenticated()
export class AdminSupplierAccountsController {
  constructor(private readonly accounts: AdminSupplierAccountsService) {}
  private actor(request: Request) {
    const session = (request as AuthorizedRequest)[AUTHENTICATED_SESSION];
    if (!session) adminError('AUTH_SESSION_REQUIRED', 401);
    return { ...session.user, sessionId: session.id };
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AdminSupplierAccountsPageDto })
  list(@Req() request: Request, @Query() query: AdminSupplierAccountsQueryDto) { return this.accounts.list(this.actor(request), query); }
  @Delete(':userId')
  @Header('Cache-Control', 'no-store')
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: AdminUserForceDeleteResultDto })
  delete(@Param('userId', ParseUUIDPipe) userId: string, @Query() query: AdminSupplierAccountTargetDto, @Body() input: DeleteAdminUserDto, @Req() request: Request) {
    return this.accounts.delete(this.actor(request), userId, query.organizationId, input, requestTraceId(request), request.get('Idempotency-Key'));
  }
}
