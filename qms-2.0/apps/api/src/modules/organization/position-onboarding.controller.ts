import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { PositionAuthorizationPreviewDto, PositionAuthorizationPreviewInputDto } from './position-onboarding.dto.js';
import { PositionOnboardingService } from './position-onboarding.service.js';

@Controller('api/v1/organizations')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class PositionOnboardingController {
  constructor(private readonly onboarding: PositionOnboardingService) {}

  @Post(':organizationId/position-authorization/preview')
  @HttpCode(200)
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: PositionAuthorizationPreviewDto })
  @RequireAccess({ featurePermission: 'organization:structure:read', organizationScope: { source: 'params', field: 'organizationId', optional: false } })
  preview(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Body() input: PositionAuthorizationPreviewInputDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.set('Cache-Control', 'no-store');
    const authorized = request as AuthorizedRequest;
    const session = authorized[AUTHENTICATED_SESSION]!;
    return this.onboarding.preview({ ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId }, organizationId, input);
  }
}
