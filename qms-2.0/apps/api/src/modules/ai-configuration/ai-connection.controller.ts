import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ConfigurationScopeDto } from '../platform-configuration/platform-configuration.dto.js';
import { AiConnectionDto, AiConnectionTestDto, AiConnectionVersionDto, CreateAiConnectionDto, UpdateAiConnectionDto } from './ai-connection.dto.js';
import { AiConnectionService } from './ai-connection.service.js';

const readAccess = { featurePermission: 'ai:connections:read', organizationScope: { source: 'query' as const, field: 'organizationId', optional: true } };
const writeAccess = { ...readAccess, featurePermission: 'ai:connections:manage' };

@Controller('api/v1/admin/ai-connections')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class AiConnectionController {
  constructor(private readonly connections: AiConnectionService) {}

  @Get() @Header('Cache-Control', 'no-store') @RequireAccess(readAccess) @ApiOkResponse({ type: AiConnectionDto, isArray: true })
  list(@Query() _query: ConfigurationScopeDto, @Req() request: AuthorizedRequest) {
    return this.connections.list(this.actor(request), request.authorizedOrganizationId!);
  }

  @Post() @Header('Cache-Control', 'no-store') @RequireAccess(writeAccess) @ApiCreatedResponse({ type: AiConnectionDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  create(@Query() _query: ConfigurationScopeDto, @Body() dto: CreateAiConnectionDto, @Req() request: AuthorizedRequest) {
    return this.connections.create(this.actor(request), request.authorizedOrganizationId!, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Patch(':id') @Header('Cache-Control', 'no-store') @RequireAccess(writeAccess) @ApiOkResponse({ type: AiConnectionDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  update(@Param('id', ParseUUIDPipe) id: string, @Query() _query: ConfigurationScopeDto, @Body() dto: UpdateAiConnectionDto, @Req() request: AuthorizedRequest) {
    return this.connections.update(this.actor(request), request.authorizedOrganizationId!, id, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Post(':id/clear-key') @Header('Cache-Control', 'no-store') @RequireAccess({ ...readAccess, featurePermission: 'ai:credentials:manage' }) @ApiCreatedResponse({ type: AiConnectionDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  clear(@Param('id', ParseUUIDPipe) id: string, @Query() _query: ConfigurationScopeDto, @Body() dto: AiConnectionVersionDto, @Req() request: AuthorizedRequest) {
    return this.connections.clear(this.actor(request), request.authorizedOrganizationId!, id, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Post(':id/test') @Header('Cache-Control', 'no-store') @RequireAccess({ ...readAccess, featurePermission: 'ai:connections:test' }) @ApiCreatedResponse({ type: AiConnectionTestDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  test(@Param('id', ParseUUIDPipe) id: string, @Query() _query: ConfigurationScopeDto, @Body() dto: AiConnectionVersionDto, @Req() request: AuthorizedRequest) {
    return this.connections.test(this.actor(request), request.authorizedOrganizationId!, id, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  private actor(request: AuthorizedRequest) { return { ...request[AUTHENTICATED_SESSION]!.user, sessionId: request[AUTHENTICATED_SESSION]!.id }; }
}
