import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { AiDescriptionTaskActionDto, AiDescriptionTaskDto, AiDescriptionTaskListDto, AiDescriptionTaskQueryDto } from './ai-description.dto.js';
import { AiDescriptionService } from './ai-description.service.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest, session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}

@Controller('api/v1/admin/integrations/ingestion/ai-tasks')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class AiDescriptionController {
  constructor(private readonly service: AiDescriptionService) {}

  @Get() @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: AiDescriptionTaskListDto })
  @RequireAccess({ featurePermission: 'ingestion:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  list(@Req() request: Request, @Query() query: AiDescriptionTaskQueryDto) { return this.service.list(actor(request), query.defectId); }

  @Post(':id/retry') @Header('Cache-Control', 'no-store') @ApiCreatedResponse({ type: AiDescriptionTaskDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'ingestion:run', organizationScope: { source: 'body', field: 'organizationId', optional: true } })
  retry(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: AiDescriptionTaskActionDto) { return this.service.action(actor(request), id, input, false, requestTraceId(request), request.get('Idempotency-Key')); }

  @Post(':id/adopt') @Header('Cache-Control', 'no-store') @ApiCreatedResponse({ type: AiDescriptionTaskDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'ingestion:run', organizationScope: { source: 'body', field: 'organizationId', optional: true } })
  adopt(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: AiDescriptionTaskActionDto) { return this.service.action(actor(request), id, input, true, requestTraceId(request), request.get('Idempotency-Key')); }
}
