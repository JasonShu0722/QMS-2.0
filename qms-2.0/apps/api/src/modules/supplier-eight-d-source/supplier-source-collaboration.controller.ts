import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { SupplierSourceCollaborationService } from './supplier-source-collaboration.service.js';
import { SupplierSourceCollaborationPageDto, SupplierSourceCollaborationQueryDto } from './supplier-source-collaboration.dto.js';

@Controller('api/v1/supplier-quality/source-collaboration')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierSourceCollaborationController {
  constructor(private readonly service: SupplierSourceCollaborationService) {}

  @Get('tasks') @RequireAuthenticated() @ApiOkResponse({ type: SupplierSourceCollaborationPageDto })
  tasks(@Req() request: Request, @Query() query: SupplierSourceCollaborationQueryDto) {
    const session = (request as AuthorizedRequest)[AUTHENTICATED_SESSION]!;
    return this.service.tasks({ ...session.user, sessionId: session.id }, query);
  }
}
