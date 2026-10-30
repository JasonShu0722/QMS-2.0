import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { adminError } from '../../common/security/admin-mutation.service.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { DataExchangeAttemptDto, DataExchangePageDto, DataExchangeQueryDto } from './data-exchange-observation.dto.js';
import { DataExchangeObservationService } from './data-exchange-observation.service.js';

@Controller('api/v1/admin/console/data-exchanges')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class DataExchangeObservationController {
  constructor(private readonly exchanges: DataExchangeObservationService) {}
  @Get() @RequireAuthenticated() @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: DataExchangePageDto })
  list(@Req() request: AuthorizedRequest, @Query() query: DataExchangeQueryDto): Promise<DataExchangePageDto> {
    const session = request[AUTHENTICATED_SESSION]; if (!session) adminError('AUTH_SESSION_REQUIRED', 401);
    return this.exchanges.list(session.user, query);
  }
  @Get('attempts/:attemptId') @RequireAuthenticated() @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: DataExchangeAttemptDto })
  detail(@Req() request: AuthorizedRequest, @Query() query: DataExchangeQueryDto, @Param('attemptId', new ParseUUIDPipe()) id: string): Promise<DataExchangeAttemptDto> {
    const session = request[AUTHENTICATED_SESSION]; if (!session) adminError('AUTH_SESSION_REQUIRED', 401);
    return this.exchanges.detail(session.user, query, id);
  }
}
