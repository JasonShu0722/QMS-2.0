import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ApprovalSignatureDto, ApprovalSignatureQueryDto, ESignatureDto, ESignaturePageDto, ESignatureQueryDto, RegisterESignatureDto, RevokeESignatureDto, SignApprovalDto } from './e-signature.dto.js';
import { APPROVAL_READ_PERMISSION, APPROVAL_SIGN_PERMISSION, SIGNATURE_READ_PERMISSION, SIGNATURE_WRITE_PERMISSION } from './e-signature.rules.js';
import { ESignatureService } from './e-signature.service.js';

function actor(request: Request) { const authorized = request as AuthorizedRequest; const session = authorized[AUTHENTICATED_SESSION]!; return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId }; }
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/e-signatures') @ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class ESignatureController {
  constructor(private readonly service: ESignatureService) {}
  @Get('mine') @ApiOkResponse({ type: ESignaturePageDto }) @RequireAccess({ featurePermission: SIGNATURE_READ_PERMISSION, organizationScope: queryScope })
  list(@Req() request: Request, @Query() query: ESignatureQueryDto) { return this.service.list(actor(request), query); }
  @Post() @ApiCreatedResponse({ type: ESignatureDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: SIGNATURE_WRITE_PERMISSION, organizationScope: bodyScope })
  register(@Req() request: Request, @Body() body: RegisterESignatureDto, @Headers('idempotency-key') key?: string) { return this.service.register(actor(request), body, requestTraceId(request), key); }
  @Post(':id/revoke') @ApiOkResponse({ type: ESignatureDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: SIGNATURE_WRITE_PERMISSION, organizationScope: bodyScope })
  revoke(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: RevokeESignatureDto, @Headers('idempotency-key') key?: string) { return this.service.revoke(actor(request), id, body, requestTraceId(request), key); }
  @Get('approvals') @ApiOkResponse({ type: [ApprovalSignatureDto] }) @RequireAccess({ featurePermission: APPROVAL_READ_PERMISSION, organizationScope: queryScope })
  approvals(@Req() request: Request, @Query() query: ApprovalSignatureQueryDto) { return this.service.approvals(actor(request), query); }
  @Post('approvals') @ApiCreatedResponse({ type: ApprovalSignatureDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: APPROVAL_SIGN_PERMISSION, organizationScope: bodyScope })
  signApproval(@Req() request: Request, @Body() body: SignApprovalDto, @Headers('idempotency-key') key?: string) { return this.service.signApproval(actor(request), body, requestTraceId(request), key); }
}
