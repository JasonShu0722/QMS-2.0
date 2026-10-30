import { Controller, Get, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { LegacyAuthorizationReadService } from './legacy-authorization-read.service.js';
import { LegacyAuthorizationHistoryPageDto, LegacyAuthorizationHistoryQueryDto, LegacyAuthorizationSourcesDto, LegacyAuthorizationSourcesQueryDto } from './legacy-authorization-read.dto.js';

const scope = { source: 'params' as const, field: 'organizationId', optional: false };
@Controller('api/v1/organizations/:organizationId')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class LegacyAuthorizationReadController {
  constructor(private readonly reads: LegacyAuthorizationReadService) {}

  @Get('legacy-authorizations/history')
  @ApiOkResponse({ type: LegacyAuthorizationHistoryPageDto })
  @RequireAccess({ featurePermission: 'account:roles:read', organizationScope: scope })
  history(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Query() query: LegacyAuthorizationHistoryQueryDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.reads.history(this.actor(req), organizationId, query);
  }

  @Get('authorization-sources')
  @ApiOkResponse({ type: LegacyAuthorizationSourcesDto })
  @RequireAccess({ featurePermission: 'account:roles:read', organizationScope: scope })
  sources(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Query() query: LegacyAuthorizationSourcesQueryDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.reads.sources(this.actor(req), organizationId, query);
  }

  private actor(req: Request) {
    const authorized = req as AuthorizedRequest;
    const session = authorized[AUTHENTICATED_SESSION]!;
    return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
  }
}
