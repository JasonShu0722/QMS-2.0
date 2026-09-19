import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { RequireAccess } from '../authorization/access.decorator.js';
import type { Request } from 'express';
import type { AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ReportingService } from './reporting.service.js';
@Controller('api/v1') @RequireAccess({ featurePermission: 'problem-index:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } }) export class ReportingController { constructor(private readonly reporting: ReportingService) {} @Get('problem-center') list(@Query() q: any, @Req() r: Request) { return this.reporting.list((r as AuthorizedRequest).authorizedOrganizationId!, q); } @Get('reports/problems/:id') report(@Param('id') id: string, @Req() r: Request) { return this.reporting.report((r as AuthorizedRequest).authorizedOrganizationId!, id); } @Get('problems/:id/audit-trail') audit(@Param('id') id: string, @Req() r: Request) { return this.reporting.audit((r as AuthorizedRequest).authorizedOrganizationId!, id); } }
