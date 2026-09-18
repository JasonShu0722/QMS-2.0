import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from './access.decorator.js';
import { AuthorizationService } from './authorization.service.js';

@Controller('api/v1/system')
export class PermissionsController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Get('permissions')
  @RequireAccess({
    featurePermission: 'system:permissions:read',
    organizationScope: { source: 'query', field: 'organizationId', optional: true },
  })
  permissions(@Req() request: Request) {
    const authorized = request as AuthorizedRequest;
    return this.authorization.permissionsForContext(
      authorized[AUTHENTICATED_SESSION]!.user.id,
      authorized.authorizedOrganizationId!,
    ).then((permissions) => ({
      organizationId: authorized.authorizedOrganizationId,
      permissions,
    }));
  }
}
