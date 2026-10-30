import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { adminError } from '../../common/security/admin-mutation.service.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { ConsoleContextDto, ConsoleContextQueryDto } from './dto/console-context.dto.js';
import { ConsoleContextService } from './console-context.service.js';

@Controller('api/v1/admin/console')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class ConsoleContextController {
  constructor(private readonly contextService: ConsoleContextService) {}

  @Get('context')
  @RequireAuthenticated()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: ConsoleContextDto })
  context(@Req() request: AuthorizedRequest, @Query() query: ConsoleContextQueryDto): Promise<ConsoleContextDto> {
    const actor = request[AUTHENTICATED_SESSION]?.user;
    if (!actor) adminError('AUTH_SESSION_REQUIRED', 401);
    return this.contextService.context(actor, query.organizationId);
  }
}
