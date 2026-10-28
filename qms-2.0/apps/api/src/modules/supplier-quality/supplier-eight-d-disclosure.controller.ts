import { Body, Controller, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { SupplierDisclosurePreviewDto, SupplierDisclosurePreviewResultDto, SupplierDisclosureReleaseDto, SupplierDisclosureReleaseResultDto } from './supplier-eight-d-disclosure.dto.js';
import { SupplierEightDDisclosureService } from './supplier-eight-d-disclosure.service.js';

@Controller('api/v1/supplier-quality/eight-d')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierEightDDisclosureController {
  constructor(private readonly disclosure: SupplierEightDDisclosureService) {}

  @Post(':id/disclosure-preview') @HttpCode(200)
  @RequireAccess({ featurePermission: 'supplier-quality:issues:issue', organizationScope: { source: 'session', optional: true } })
  @ApiHeader({ name: 'x-csrf-token', required: true }) @ApiOkResponse({ type: SupplierDisclosurePreviewResultDto })
  preview(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: SupplierDisclosurePreviewDto) {
    const session = request[AUTHENTICATED_SESSION]!;
    return this.disclosure.preview({ ...session.user, sessionId: session.id }, id, body, requestTraceId(request));
  }

  @Post(':id/release') @HttpCode(200)
  @RequireAccess({ featurePermission: 'supplier-quality:issues:issue', organizationScope: { source: 'session', optional: true } })
  @ApiHeader({ name: 'x-csrf-token', required: true }) @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: SupplierDisclosureReleaseResultDto })
  release(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: SupplierDisclosureReleaseDto, @Headers('idempotency-key') key: string) {
    const session = request[AUTHENTICATED_SESSION]!;
    return this.disclosure.release({ ...session.user, sessionId: session.id }, id, body, key, requestTraceId(request));
  }
}
