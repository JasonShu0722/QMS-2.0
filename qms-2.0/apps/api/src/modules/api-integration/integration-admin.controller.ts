import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { CreateIntegrationCredentialDto, CreateIntegrationEndpointDto, IntegrationCredentialDto, IntegrationCredentialPageDto, IntegrationEndpointDto, IntegrationEndpointPageDto, IntegrationPageQueryDto, IntegrationScopeDto, UpdateIntegrationEndpointDto } from './integration-admin.dto.js';
import { IntegrationAdminService } from './integration-admin.service.js';
import { IntegrationCredentialService } from './integration-credential.service.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;
const credentialPermissions = () => ['integration:manage', 'integration:credentials:manage'];

@Controller('api/v1/admin/integrations/endpoints')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class IntegrationAdminController {
  constructor(private readonly service: IntegrationAdminService, private readonly credentials: IntegrationCredentialService) {}

  @Get() @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IntegrationEndpointPageDto })
  @RequireAccess({ featurePermission: 'integration:read', organizationScope: queryScope })
  list(@Req() request: Request, @Query() query: IntegrationPageQueryDto) { return this.service.listEndpoints(actor(request), query); }

  @Get(':id') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IntegrationEndpointDto })
  @RequireAccess({ featurePermission: 'integration:read', organizationScope: queryScope })
  get(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: IntegrationScopeDto) { return this.service.endpoint(actor(request), id); }

  @Post() @Header('Cache-Control', 'no-store') @ApiCreatedResponse({ type: IntegrationEndpointDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'integration:manage', organizationScope: bodyScope })
  create(@Req() request: Request, @Body() input: CreateIntegrationEndpointDto) { return this.service.createEndpoint(actor(request), input, requestTraceId(request), request.get('Idempotency-Key')); }

  @Patch(':id') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IntegrationEndpointDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'integration:manage', organizationScope: bodyScope })
  update(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateIntegrationEndpointDto) { return this.service.updateEndpoint(actor(request), id, input, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get(':id/credentials') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IntegrationCredentialPageDto })
  @RequireAccess({ featurePermission: 'integration:credentials:manage', organizationScope: queryScope })
  listCredentials(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() query: IntegrationPageQueryDto) { return this.credentials.listCredentials(actor(request), id, query); }

  @Post(':id/credentials') @Header('Cache-Control', 'no-store') @ApiCreatedResponse({ type: IntegrationCredentialDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'integration:credentials:manage', featurePermissions: credentialPermissions, organizationScope: bodyScope })
  createCredential(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: CreateIntegrationCredentialDto) { return this.credentials.createCredential(actor(request), id, input, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post(':id/credentials/:credentialId/revoke') @Header('Cache-Control', 'no-store') @ApiCreatedResponse({ type: IntegrationCredentialDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'integration:credentials:manage', featurePermissions: credentialPermissions, organizationScope: bodyScope })
  revokeCredential(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Param('credentialId', ParseUUIDPipe) credentialId: string, @Body() _input: IntegrationScopeDto) { return this.credentials.revokeCredential(actor(request), id, credentialId, requestTraceId(request), request.get('Idempotency-Key')); }
}
