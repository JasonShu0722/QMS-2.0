import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { MaterialMasterService } from './material-master.service.js';
import { CreateMaterialMasterDto, MaterialMasterDto, MaterialMasterImportDto, MaterialMasterImportResultDto, MaterialMasterScopeDto, UpdateMaterialMasterDto } from './material-master.dto.js';

function actor(request: Request) { const authorized = request as AuthorizedRequest; const session = authorized[AUTHENTICATED_SESSION]!; return { ...session.user, sessionId: session.id, scopeOrganizationId: authorized.authorizedOrganizationId }; }
const queryScope = { source: 'query', field: 'organizationId', optional: true } as const;
const bodyScope = { source: 'body', field: 'organizationId', optional: true } as const;

@Controller('api/v1/material-masters')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class MaterialMasterController {
  constructor(private readonly service: MaterialMasterService) {}
  @Get() @ApiOkResponse({ type: [MaterialMasterDto] }) @RequireAccess({ featurePermission: 'material-master:read', organizationScope: queryScope }) list(@Req() request: Request, @Query() _query: MaterialMasterScopeDto) { return this.service.listMaterials(actor(request)); }
  @Post() @ApiCreatedResponse({ type: MaterialMasterDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'material-master:write', organizationScope: bodyScope }) create(@Req() request: Request, @Body() dto: CreateMaterialMasterDto) { return this.service.createMaterial(actor(request), dto, requestTraceId(request), request.get('Idempotency-Key')); }
  @Patch(':id') @ApiOkResponse({ type: MaterialMasterDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'material-master:write', organizationScope: bodyScope }) update(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMaterialMasterDto) { return this.service.updateMaterial(actor(request), id, dto, requestTraceId(request), request.get('Idempotency-Key')); }
  @Post('import') @ApiCreatedResponse({ type: MaterialMasterImportResultDto }) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true }) @RequireAccess({ featurePermission: 'material-master:import', organizationScope: bodyScope }) import(@Req() request: Request, @Body() dto: MaterialMasterImportDto) { return this.service.importMaterials(actor(request), dto.rows, requestTraceId(request), request.get('Idempotency-Key')); }
}
