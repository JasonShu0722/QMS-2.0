import { Body, Controller, Get, Headers, Put, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ProcessEightDWorkflowConfigurationDto, UpdateProcessEightDWorkflowConfigurationDto } from './process-eight-d-workflow-configuration.dto.js';
import { ProcessEightDWorkflowConfigurationService } from './process-eight-d-workflow-configuration.service.js';

const access = { featurePermission: 'workflow:manage', organizationScope: { source: 'session' } } as const;

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: request.authorizedOrganizationId };
}

@Controller('api/v1/process-quality/eight-d-workflow-configuration')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class ProcessEightDWorkflowConfigurationController {
  constructor(private readonly configuration: ProcessEightDWorkflowConfigurationService) {}

  @Get()
  @RequireAccess(access)
  @ApiOkResponse({ type: ProcessEightDWorkflowConfigurationDto })
  get(@Req() request: AuthorizedRequest) { return this.configuration.get(actor(request)); }

  @Put()
  @RequireAccess(access)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: ProcessEightDWorkflowConfigurationDto })
  update(@Req() request: AuthorizedRequest, @Body() body: UpdateProcessEightDWorkflowConfigurationDto, @Headers('idempotency-key') key?: string) {
    return this.configuration.update(actor(request), body, requestTraceId(request), key);
  }
}
