import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { IntegrationScopeDto } from './integration-admin.dto.js';
import { DeleteIntegrationReceiptsDto, IntegrationAttemptPageDto, IntegrationOperationDto, IntegrationPayloadDto, IntegrationReceiptDeleteResultDto, IntegrationReceiptDto, IntegrationReceiptEndpointPageDto, IntegrationReceiptEndpointQueryDto, IntegrationReceiptPageDto, IntegrationReceiptQueryDto, UpdateIntegrationCapacityDto } from './integration-receipt.dto.js';
import { IntegrationReceiptService } from './integration-receipt.service.js';

const scope = { source: 'query', field: 'organizationId', optional: true } as const;
const actor = (request: Request) => { const authorized = request as AuthorizedRequest, session = authorized[AUTHENTICATED_SESSION]!; return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId }; };

@Controller('api/v1/admin/integrations')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class IntegrationReceiptController {
  constructor(private readonly service: IntegrationReceiptService) {}
  @Get('receipts') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IntegrationReceiptPageDto }) @RequireAccess({ featurePermission: 'integration:receipts:read', organizationScope: scope })
  receipts(@Req() request: Request, @Query() query: IntegrationReceiptQueryDto) { return this.service.listReceipts(actor(request), query); }
  @Delete('receipts') @Header('Cache-Control', 'no-store') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiOkResponse({ type: IntegrationReceiptDeleteResultDto }) @RequireAccess({ featurePermission: 'integration:manage', organizationScope: { source: 'body', field: 'organizationId', optional: true } })
  remove(@Req() request: Request, @Body() input: DeleteIntegrationReceiptsDto) { return this.service.deleteReceipts(actor(request), input, requestTraceId(request), request.get('Idempotency-Key')); }
  @Get('receipt-endpoints') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IntegrationReceiptEndpointPageDto }) @RequireAccess({ featurePermission: 'integration:receipts:read', organizationScope: scope })
  endpoints(@Req() request: Request, @Query() query: IntegrationReceiptEndpointQueryDto) { return this.service.listReceiptEndpoints(actor(request), query); }
  @Get('attempts') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IntegrationAttemptPageDto }) @RequireAccess({ featurePermission: 'integration:receipts:read', organizationScope: scope })
  attempts(@Req() request: Request, @Query() query: IntegrationReceiptQueryDto) { return this.service.listAttempts(actor(request), query); }
  @Get('status') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IntegrationOperationDto }) @RequireAccess({ featurePermission: 'integration:receipts:read', organizationScope: scope })
  status(@Req() request: Request, @Query() _query: IntegrationScopeDto) { return this.service.operations(actor(request)); }
  @Patch('status') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IntegrationOperationDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'integration:manage', organizationScope: { source: 'body', field: 'organizationId', optional: true } })
  updateStatus(@Req() request: Request, @Body() input: UpdateIntegrationCapacityDto) { return this.service.updateCapacity(actor(request), input, requestTraceId(request), request.get('Idempotency-Key')); }
  @Get('receipts/:id') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IntegrationReceiptDto }) @RequireAccess({ featurePermission: 'integration:receipts:read', organizationScope: scope })
  receipt(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: IntegrationScopeDto) { return this.service.receipt(actor(request), id); }
  @Get('receipts/:id/payload') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: IntegrationPayloadDto }) @RequireAccess({ featurePermission: 'integration:receipts:read', organizationScope: scope, featurePermissions: () => ['integration:receipts:read','integration:payload:read'] })
  payload(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: IntegrationScopeDto) { return this.service.payload(actor(request), id, requestTraceId(request)); }
}
