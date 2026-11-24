import { Body, Controller, Get, Headers, Put, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ProcessLedgerWorkflowCapabilitiesDto, ProcessLedgerWorkflowConfigurationDto, UpdateProcessLedgerWorkflowConfigurationDto } from './process-ledger-workflow-configuration.dto.js';
import { ProcessLedgerWorkflowConfigurationService } from './process-ledger-workflow-configuration.service.js';

const sessionScope = { source: 'session' } as const;

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: request.authorizedOrganizationId };
}

@Controller('api/v1/process-quality/ledger-workflow-configuration')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class ProcessLedgerWorkflowConfigurationController {
  constructor(private readonly configuration: ProcessLedgerWorkflowConfigurationService) {}

  @Get()
  @RequireAccess({ featurePermission: 'workflow:manage', organizationScope: sessionScope })
  @ApiOkResponse({ type: ProcessLedgerWorkflowConfigurationDto })
  get(@Req() request: AuthorizedRequest) { return this.configuration.get(actor(request)); }

  @Put()
  @RequireAccess({ featurePermission: 'workflow:manage', organizationScope: sessionScope })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: ProcessLedgerWorkflowConfigurationDto })
  update(@Req() request: AuthorizedRequest, @Body() body: UpdateProcessLedgerWorkflowConfigurationDto, @Headers('idempotency-key') key?: string) {
    return this.configuration.update(actor(request), body, requestTraceId(request), key);
  }

  @Get('capabilities')
  @RequireAccess({ featurePermission: 'process-quality:defects:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } })
  @ApiQuery({ name: 'organizationId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ type: ProcessLedgerWorkflowCapabilitiesDto })
  capabilities(@Req() request: AuthorizedRequest) { return this.configuration.capabilities(actor(request)); }
}
