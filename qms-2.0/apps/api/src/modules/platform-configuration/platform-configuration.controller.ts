import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ConfigurationScopeDto, CreatePositionCategoryDto, type NotificationKind, NotificationRuleDto, PlatformSettingsDto, PositionCategoryDto, UpdateNotificationRuleDto, UpdatePlatformSettingsDto, UpdatePositionCategoryDto } from './platform-configuration.dto.js';
import { PlatformConfigurationService } from './platform-configuration.service.js';

const readAccess = { featurePermission: 'configuration:read', organizationScope: { source: 'query' as const, field: 'organizationId', optional: true } };
const writeAccess = { ...readAccess, featurePermission: 'configuration:manage' };

@Controller('api/v1/admin/configuration')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class PlatformConfigurationController {
  constructor(private readonly configuration: PlatformConfigurationService) {}

  @Get('settings') @RequireAccess(readAccess) @ApiOkResponse({ type: PlatformSettingsDto })
  settings(@Query() _query: ConfigurationScopeDto, @Req() request: AuthorizedRequest) {
    return this.configuration.settings(this.actor(request), request.authorizedOrganizationId!);
  }

  @Patch('settings') @RequireAccess(writeAccess) @ApiOkResponse({ type: PlatformSettingsDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  updateSettings(@Query() _query: ConfigurationScopeDto, @Body() dto: UpdatePlatformSettingsDto, @Req() request: AuthorizedRequest) {
    return this.configuration.updateSettings(this.actor(request), request.authorizedOrganizationId!, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Get('notification-rules') @RequireAccess(readAccess) @ApiOkResponse({ type: NotificationRuleDto, isArray: true })
  rules(@Query() _query: ConfigurationScopeDto, @Req() request: AuthorizedRequest) {
    return this.configuration.rules(this.actor(request), request.authorizedOrganizationId!);
  }

  @Patch('notification-rules/:kind') @RequireAccess(writeAccess) @ApiOkResponse({ type: NotificationRuleDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  updateRule(@Param('kind') kind: NotificationKind, @Query() _query: ConfigurationScopeDto, @Body() dto: UpdateNotificationRuleDto, @Req() request: AuthorizedRequest) {
    return this.configuration.updateRule(this.actor(request), request.authorizedOrganizationId!, kind, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Get('position-categories') @RequireAccess(readAccess) @ApiOkResponse({ type: PositionCategoryDto, isArray: true })
  categories(@Query() _query: ConfigurationScopeDto, @Req() request: AuthorizedRequest) {
    return this.configuration.categories(this.actor(request), request.authorizedOrganizationId!);
  }

  @Post('position-categories') @RequireAccess(writeAccess) @ApiCreatedResponse({ type: PositionCategoryDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  createCategory(@Query() _query: ConfigurationScopeDto, @Body() dto: CreatePositionCategoryDto, @Req() request: AuthorizedRequest) {
    return this.configuration.createCategory(this.actor(request), request.authorizedOrganizationId!, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Patch('position-categories/:id') @RequireAccess(writeAccess) @ApiOkResponse({ type: PositionCategoryDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Query() _query: ConfigurationScopeDto, @Body() dto: UpdatePositionCategoryDto, @Req() request: AuthorizedRequest) {
    return this.configuration.updateCategory(this.actor(request), request.authorizedOrganizationId!, id, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  private actor(request: AuthorizedRequest) {
    return { ...request[AUTHENTICATED_SESSION]!.user, sessionId: request[AUTHENTICATED_SESSION]!.id };
  }
}
