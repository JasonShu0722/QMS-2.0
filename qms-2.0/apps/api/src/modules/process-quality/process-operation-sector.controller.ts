import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ProcessOperationSectorService } from './process-operation-sector.service.js';
import { DeletedProcessOperationSectorDto, DeleteProcessOperationSectorDto, ProcessOperationSectorDto, ProcessOperationSectorInputDto, ProcessScopeDto, UpdateProcessOperationSectorDto } from './process-quality.dto.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/process-quality/operation-sectors')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class ProcessOperationSectorController {
  constructor(private readonly service: ProcessOperationSectorService) {}

  @Get() @ApiOkResponse({ type: [ProcessOperationSectorDto] })
  @RequireAccess({ featurePermission: 'process-quality:configuration:read', organizationScope: queryScope })
  list(@Req() request: Request, @Query() _query: ProcessScopeDto) { return this.service.list(actor(request)); }

  @Post() @ApiCreatedResponse({ type: ProcessOperationSectorDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:configuration:manage', organizationScope: bodyScope })
  create(@Req() request: Request, @Body() body: ProcessOperationSectorInputDto, @Headers('idempotency-key') key?: string) {
    return this.service.create(actor(request), body, requestTraceId(request), key);
  }

  @Put(':id') @ApiOkResponse({ type: ProcessOperationSectorDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:configuration:manage', organizationScope: bodyScope })
  update(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateProcessOperationSectorDto, @Headers('idempotency-key') key?: string) {
    return this.service.update(actor(request), id, body, requestTraceId(request), key);
  }

  @Delete(':id') @ApiOkResponse({ type: DeletedProcessOperationSectorDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'process-quality:configuration:manage', organizationScope: queryScope })
  remove(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() query: DeleteProcessOperationSectorDto, @Headers('idempotency-key') key?: string) {
    return this.service.remove(actor(request), id, query.expectedVersion, requestTraceId(request), key);
  }
}
