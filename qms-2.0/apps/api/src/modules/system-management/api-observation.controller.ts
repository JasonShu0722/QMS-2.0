import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { adminError } from '../../common/security/admin-mutation.service.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { ApiObservationPageDto, ApiObservationQueryDto } from './api-observation.dto.js';
import { ApiObservationService } from './api-observation.service.js';

@Controller('api/v1/admin/console/api-observations')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class ApiObservationController {
  constructor(private readonly observations: ApiObservationService) {}
  @Get() @RequireAuthenticated() @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: ApiObservationPageDto })
  query(@Req() request: AuthorizedRequest, @Query() query: ApiObservationQueryDto): Promise<ApiObservationPageDto> {
    const session = request[AUTHENTICATED_SESSION];
    if (!session) adminError('AUTH_SESSION_REQUIRED', 401);
    return this.observations.query(session.user, query);
  }
}
