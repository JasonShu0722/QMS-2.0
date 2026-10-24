import { Body, Controller, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { ComponentProjectScopeDto } from './component-project.dto.js';
import { ComponentProjectBulkService } from './component-project-bulk.service.js';
import { ComponentProjectBulkPreviewDto, ComponentProjectBulkApplyDto, ComponentProjectBulkPreviewResultDto, ComponentProjectBulkApplyResultDto } from './component-project-bulk.dto.js';

const access = { featurePermission: 'component-project:manage', organizationScope: { source: 'query' as const, field: 'organizationId', optional: true } };

@Controller('api/v1/admin/configuration/component-project-mappings')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class ComponentProjectBulkController {
  constructor(private readonly service: ComponentProjectBulkService) {}

  @Post('bulk-preview') @HttpCode(200) @RequireAccess(access)
  @ApiOkResponse({ type: ComponentProjectBulkPreviewResultDto })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  preview(@Query() _query: ComponentProjectScopeDto, @Body() dto: ComponentProjectBulkPreviewDto, @Req() request: AuthorizedRequest) {
    return this.service.preview(this.actor(request), request.authorizedOrganizationId!, dto);
  }

  @Post('bulk-apply') @HttpCode(200) @RequireAccess(access)
  @ApiOkResponse({ type: ComponentProjectBulkApplyResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  apply(@Query() _query: ComponentProjectScopeDto, @Body() dto: ComponentProjectBulkApplyDto, @Req() request: AuthorizedRequest) {
    return this.service.apply(this.actor(request), request.authorizedOrganizationId!, dto, requestTraceId(request), request.get('Idempotency-Key'));
  }

  private actor(request: AuthorizedRequest) {
    return { ...request[AUTHENTICATED_SESSION]!.user, sessionId: request[AUTHENTICATED_SESSION]!.id };
  }
}
