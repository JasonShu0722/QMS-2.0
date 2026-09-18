import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiCookieAuth, ApiOkResponse, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { CurrentOrganizationResponseDto } from './organization.dto.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { OrganizationService } from './organization.service.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';

@Controller('api/v1/organizations')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}

  @Get('current')
  @ApiOkResponse({ type: CurrentOrganizationResponseDto })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  @RequireAccess({
    featurePermission: 'organization:read',
    organizationScope: { source: 'query', field: 'organizationId', optional: true },
  })
  current(@Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    return this.organizations.current(
      authorized[AUTHENTICATED_SESSION]!.user.id,
      authorized.authorizedOrganizationId!,
    );
  }
}
