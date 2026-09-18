import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequireAccess } from '../authorization/access.decorator.js';
import { OrganizationService } from './organization.service.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';

@Controller('api/v1/organizations')
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}

  @Get('current')
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
