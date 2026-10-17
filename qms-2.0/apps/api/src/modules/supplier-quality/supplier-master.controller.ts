import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { TemporaryPasswordDto } from '../identity/dto/password-change-challenge.dto.js';
import { CreateSupplierAccountDto, CreatedSupplierAccountDto, SetSupplierAccountStatusDto, SupplierAccountDto, SupplierAccountPageDto, SupplierAccountScopeDto } from './supplier-account.dto.js';
import { SupplierAccountService } from './supplier-account.service.js';
import { SupplierProfileImportDto, SupplierProfileImportResultDto } from './supplier-profile-import.dto.js';
import { SupplierProfileImportService } from './supplier-profile-import.service.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/supplier-quality/profiles')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierMasterController {
  constructor(private readonly accounts: SupplierAccountService, private readonly imports: SupplierProfileImportService) {}

  @Post('import') @ApiCreatedResponse({ type: SupplierProfileImportResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:profiles:write', organizationScope: bodyScope })
  import(@Req() request: Request, @Body() dto: SupplierProfileImportDto) { return this.imports.import(actor(request), dto, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get(':id/accounts') @ApiOkResponse({ type: SupplierAccountPageDto })
  @RequireAccess({ featurePermission: 'supplier-quality:profiles:read', organizationScope: queryScope })
  list(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Query() _query: SupplierAccountScopeDto) { return this.accounts.list(actor(request), id); }

  @Post(':id/accounts') @ApiCreatedResponse({ type: CreatedSupplierAccountDto })
  @Header('Cache-Control', 'no-store')
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:profiles:write', organizationScope: bodyScope })
  create(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSupplierAccountDto) { return this.accounts.create(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }

  @Get(':id/accounts/:userId/temporary-password') @ApiOkResponse({ type: TemporaryPasswordDto })
  @Header('Cache-Control', 'no-store')
  @RequireAccess({ featurePermission: 'supplier-quality:profiles:write', organizationScope: queryScope })
  temporaryPassword(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Query() _query: SupplierAccountScopeDto) { return this.accounts.temporaryPassword(actor(request), id, userId, requestTraceId(request)); }

  @Post(':id/accounts/:userId/temporary-password/reset') @ApiCreatedResponse({ type: TemporaryPasswordDto })
  @Header('Cache-Control', 'no-store')
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:profiles:write', organizationScope: bodyScope })
  reset(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() _dto: SupplierAccountScopeDto) { return this.accounts.reset(actor(request), id, userId, requestTraceId(request), request.get('Idempotency-Key')); }

  @Put(':id/accounts/:userId/status') @ApiOkResponse({ type: SupplierAccountDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:profiles:write', organizationScope: bodyScope })
  setStatus(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: SetSupplierAccountStatusDto) { return this.accounts.setStatus(actor(request), id, userId, dto, requestTraceId(request), request.get('Idempotency-Key')); }
}
