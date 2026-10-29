import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from './common/contracts/error-response.js';
import { requestTraceId } from './common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from './common/guards/authenticated.guard.js';
import { adminError } from './common/security/admin-mutation.service.js';
import { AdministrativeReconfigurationDto, AdministrativeReconfigurationKind, AdministrativeReconfigurationPageDto,
  AdministrativeReconfigurationQueryDto, AdministrativeReconfigurationResultDto } from './common/security/administrative-reconfiguration.dto.js';
import { RequireAuthenticated } from './modules/authorization/access.decorator.js';
import { OrganizationReconfigurationService } from './modules/organization/organization-reconfiguration.service.js';
import { AdminUserReconfigurationService } from './modules/identity/admin-user-reconfiguration.service.js';

@Controller('api/v1/admin/reconfiguration')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
@RequireAuthenticated()
export class AdministrativeReconfigurationController {
  constructor(private readonly organizations: OrganizationReconfigurationService, private readonly users: AdminUserReconfigurationService) {}

  @Get()
  @ApiOkResponse({ type: AdministrativeReconfigurationPageDto })
  list(@Query() query: AdministrativeReconfigurationQueryDto, @Req() request: Request) {
    const actor = this.actor(request);
    return query.kind === AdministrativeReconfigurationKind.USER ? this.users.listPending(actor, query) : this.organizations.listPending(actor, query);
  }

  @Post(':kind/:id')
  @ApiCreatedResponse({ type: AdministrativeReconfigurationResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  restore(@Param('kind', new ParseEnumPipe(AdministrativeReconfigurationKind)) kind: AdministrativeReconfigurationKind,
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdministrativeReconfigurationDto, @Req() request: Request) {
    const actor = this.actor(request);
    const traceId = requestTraceId(request);
    const key = request.get('Idempotency-Key');
    return kind === AdministrativeReconfigurationKind.USER ? this.users.restore(actor, id, dto, traceId, key)
      : this.organizations.restore(actor, kind, id, dto, traceId, key,
        (tx, authenticatedActor, organizationId) => this.users.invalidateSessionsForOrganizationRestoration(tx, authenticatedActor, organizationId));
  }

  private actor(request: Request) {
    const session = (request as AuthorizedRequest)[AUTHENTICATED_SESSION];
    if (!session) adminError('AUTH_SESSION_REQUIRED', 401);
    return { id: session.user.id, organizationId: session.user.organizationId, accountType: session.user.accountType, sessionId: session.id };
  }
}
