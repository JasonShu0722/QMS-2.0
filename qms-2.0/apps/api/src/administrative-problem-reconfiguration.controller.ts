import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiExtraModels, ApiHeader, ApiOkResponse, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from './common/contracts/error-response.js';
import { requestTraceId } from './common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from './common/guards/authenticated.guard.js';
import { adminError } from './common/security/admin-mutation.service.js';
import { RequireAuthenticated } from './modules/authorization/access.decorator.js';
import { InternalEightDAdministrativePendingPageDto, InternalEightDAdministrativeQueryDto, InternalEightDAdministrativeResultDto } from './common/eight-d/internal-eight-d-administrative.dto.js';
import { SupplierEightDAdministrativePageDto, SupplierEightDAdministrativeResultDto } from './modules/supplier-quality/supplier-eight-d-administrative.dto.js';
import { AdministrativeProblemDomain, AdministrativeProblemAssignmentQueryDto, AdministrativeProblemAssignmentPageDto, AdministrativeProblemReconfigureDto } from './administrative-problem-reconfiguration.dto.js';
import { AdministrativeProblemReconfigurationService } from './administrative-problem-reconfiguration.service.js';

@Controller('api/v1/admin/problem-reconfiguration')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
@ApiExtraModels(InternalEightDAdministrativePendingPageDto, SupplierEightDAdministrativePageDto, InternalEightDAdministrativeResultDto, SupplierEightDAdministrativeResultDto)
@RequireAuthenticated()
export class AdministrativeProblemReconfigurationController {
  constructor(private readonly reconfiguration: AdministrativeProblemReconfigurationService) {}
  private actor(request: Request) {
    const session = (request as AuthorizedRequest)[AUTHENTICATED_SESSION];
    if (!session) adminError('AUTH_SESSION_REQUIRED', 401);
    return { ...session.user, sessionId: session.id };
  }
  @Get(':domain/assignments')
  @ApiOkResponse({ type: AdministrativeProblemAssignmentPageDto })
  assignments(@Param('domain', new ParseEnumPipe(AdministrativeProblemDomain)) domain: AdministrativeProblemDomain,
    @Query() query: AdministrativeProblemAssignmentQueryDto, @Req() request: Request) {
    return this.reconfiguration.assignments(this.actor(request), domain, query);
  }
  @Get(':domain')
  @ApiOkResponse({ schema: { oneOf: [InternalEightDAdministrativePendingPageDto, SupplierEightDAdministrativePageDto].map(type => ({ $ref: getSchemaPath(type) })) } })
  pending(@Param('domain', new ParseEnumPipe(AdministrativeProblemDomain)) domain: AdministrativeProblemDomain,
    @Query() query: InternalEightDAdministrativeQueryDto, @Req() request: Request) {
    return this.reconfiguration.pending(this.actor(request), domain, query);
  }
  @Post(':domain/:id')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiResponse({ status: 201, schema: { oneOf: [InternalEightDAdministrativeResultDto, SupplierEightDAdministrativeResultDto].map(type => ({ $ref: getSchemaPath(type) })) } })
  reconfigure(@Param('domain', new ParseEnumPipe(AdministrativeProblemDomain)) domain: AdministrativeProblemDomain,
    @Param('id', ParseUUIDPipe) id: string, @Body() input: AdministrativeProblemReconfigureDto, @Req() request: Request) {
    return this.reconfiguration.reconfigure(this.actor(request), domain, id, input, requestTraceId(request), request.get('Idempotency-Key'));
  }
}
