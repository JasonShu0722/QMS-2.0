import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { SupplierCopyDraftInputDto, SupplierCopyDraftReceiptDto, SupplierCopyPreviewDto, SupplierCopyPreviewInputDto } from './supplier-eight-d-source.dto.js';
import { SupplierEightDSourceService } from './supplier-eight-d-source.service.js';

function actor(request: Request) {
  const authorized = request as AuthorizedRequest;
  const session = authorized[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId };
}
const scope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/supplier-quality/source-copies')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierEightDSourceController {
  constructor(private readonly service: SupplierEightDSourceService) {}

  @Post('preview') @ApiCreatedResponse({ type: SupplierCopyPreviewDto })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:issues:copy', organizationScope: scope })
  preview(@Req() request: Request, @Body() dto: SupplierCopyPreviewInputDto) {
    return this.service.preview(actor(request), dto, requestTraceId(request));
  }

  @Post('drafts') @ApiCreatedResponse({ type: SupplierCopyDraftReceiptDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  @RequireAccess({ featurePermission: 'supplier-quality:issues:copy', organizationScope: scope })
  create(@Req() request: Request, @Body() dto: SupplierCopyDraftInputDto) {
    return this.service.createDraft(actor(request), dto, requestTraceId(request), request.get('Idempotency-Key'));
  }
}
