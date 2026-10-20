import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { RequireAuthenticated } from './access.decorator.js';
import { AccountOverviewService } from './account-overview.service.js';
import { AccountOverviewDto, AccountOverviewQueryDto } from './account-overview.dto.js';

@Controller('api/v1/me/overview')
@RequireAuthenticated()
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class AccountOverviewController {
  constructor(private readonly service: AccountOverviewService) {}

  @Get()
  @ApiOkResponse({ type: AccountOverviewDto })
  overview(@Req() request: Request, @Query() _query: AccountOverviewQueryDto) {
    return this.service.current((request as AuthorizedRequest)[AUTHENTICATED_SESSION]!.user);
  }
}
