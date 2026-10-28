import { Body, Controller, Get, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ActivateSupplierWorkflowBindingDto, SetSupplierWorkflowBindingDto, SupplierBindingScopeDto, SupplierWorkflowBindingDto, SupplierWorkflowBindingsDto } from './supplier-workflow-binding.dto.js';
import { SupplierWorkflowBindingService } from './supplier-workflow-binding.service.js';

const scope = { source: 'query', field: 'organizationId', optional: true } as const;

@Controller('api/v1/supplier-quality/workflow-bindings')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierWorkflowBindingController {
  constructor(private readonly bindings: SupplierWorkflowBindingService) {}

  @Get() @RequireAccess({ featurePermission: 'configuration:read', organizationScope: scope })
  @ApiOkResponse({ type: SupplierWorkflowBindingsDto })
  list(@Req() request: AuthorizedRequest, @Query() _scope: SupplierBindingScopeDto) {
    return this.bindings.list(this.actor(request), request.authorizedOrganizationId!);
  }

  @Put() @RequireAccess({ featurePermission: 'configuration:manage', organizationScope: scope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: SupplierWorkflowBindingDto })
  set(@Req() request: AuthorizedRequest, @Query() _scope: SupplierBindingScopeDto, @Body() dto: SetSupplierWorkflowBindingDto) {
    return this.bindings.set(this.actor(request), request.authorizedOrganizationId!, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  @Put('activation') @RequireAccess({ featurePermission: 'configuration:manage', organizationScope: scope })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: SupplierWorkflowBindingDto })
  activate(@Req() request: AuthorizedRequest, @Query() _scope: SupplierBindingScopeDto, @Body() dto: ActivateSupplierWorkflowBindingDto) {
    return this.bindings.activate(this.actor(request), request.authorizedOrganizationId!, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  private actor(request: AuthorizedRequest) { const session = request[AUTHENTICATED_SESSION]!; return { ...session.user, sessionId: session.id }; }
}
