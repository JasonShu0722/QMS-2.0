import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { LegacyAuthorizationMigrationService } from './legacy-authorization-migration.service.js';
import { LegacyAuthorizationCommitDto, LegacyAuthorizationPreviewDto, LegacyAuthorizationPreviewInputDto, LegacyAuthorizationResultDto, LegacyAuthorizationRoleDto } from './legacy-authorization-migration.dto.js';

const scope = { source: 'params' as const, field: 'organizationId', optional: false };
@Controller('api/v1/organizations/:organizationId/legacy-authorizations')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse, description: 'Controlled API error' })
export class LegacyAuthorizationMigrationController {
  constructor(private readonly migrations: LegacyAuthorizationMigrationService) {}

  @Get()
  @ApiOkResponse({ type: LegacyAuthorizationRoleDto, isArray: true })
  @RequireAccess({ featurePermission: 'account:roles:read', organizationScope: scope })
  list(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.migrations.list(this.actor(req), organizationId);
  }

  @Post(':roleId/preview') @HttpCode(200)
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: LegacyAuthorizationPreviewDto })
  @RequireAccess({ featurePermission: 'account:roles:read', organizationScope: scope })
  preview(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('roleId', ParseUUIDPipe) roleId: string, @Body() input: LegacyAuthorizationPreviewInputDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.migrations.preview(this.actor(req), organizationId, roleId, input);
  }

  @Post(':roleId/commit') @HttpCode(200)
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: LegacyAuthorizationResultDto })
  @RequireAccess({ featurePermission: 'account:roles:assign', organizationScope: scope })
  commit(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('roleId', ParseUUIDPipe) roleId: string, @Body() input: LegacyAuthorizationCommitDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.migrations.commit(this.actor(req), organizationId, roleId, input, requestTraceId(req), req.get('Idempotency-Key'));
  }

  private actor(req: Request) {
    const authorized = req as AuthorizedRequest;
    const session = authorized[AUTHENTICATED_SESSION]!;
    return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
  }
}
