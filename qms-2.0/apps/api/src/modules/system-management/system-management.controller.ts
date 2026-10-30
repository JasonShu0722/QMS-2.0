import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { adminError } from '../../common/security/admin-mutation.service.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { ConsoleContextQueryDto } from '../identity/dto/console-context.dto.js';
import { ConsoleHomeDto } from './system-management.dto.js';
import { SystemManagementService } from './system-management.service.js';

@Controller('api/v1/admin/console')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SystemManagementController {
  constructor(private readonly management: SystemManagementService) {}

  @Get('home')
  @RequireAuthenticated()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: ConsoleHomeDto })
  home(@Req() request: AuthorizedRequest, @Query() query: ConsoleContextQueryDto): Promise<ConsoleHomeDto> {
    const session = request[AUTHENTICATED_SESSION];
    if (!session) adminError('AUTH_SESSION_REQUIRED', 401);
    return this.management.home({ ...session.user, sessionId: session.id }, query.organizationId);
  }
}
