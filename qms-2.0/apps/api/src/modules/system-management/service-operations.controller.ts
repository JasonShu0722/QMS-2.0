import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { adminError } from '../../common/security/admin-mutation.service.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { ServiceOperationsService } from './service-operations.service.js';
import { ServiceOperationsPageDto, ServiceOperationsQueryDto } from './service-operations.dto.js';

@Controller('api/v1/admin/console/services')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class ServiceOperationsController {
  constructor(private readonly operations: ServiceOperationsService) {}
  @Get() @RequireAuthenticated() @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: ServiceOperationsPageDto })
  read(@Req() request: AuthorizedRequest, @Query() query: ServiceOperationsQueryDto): Promise<ServiceOperationsPageDto> {
    const session = request[AUTHENTICATED_SESSION];
    if (!session) adminError('AUTH_SESSION_REQUIRED', 401);
    return this.operations.read({ ...session.user, sessionId: session.id }, query);
  }
}
