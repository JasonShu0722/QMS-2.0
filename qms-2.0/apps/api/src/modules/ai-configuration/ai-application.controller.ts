import { Body, Controller, Get, Header, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { AiApplicationDto, AiApplicationInvocationPageDto, AiApplicationPageDto, AiApplicationQueryDto, AiApplicationRevisionDto, AiApplicationSettingsDto, AiApplicationTestResultDto, TestAiApplicationDto, UpdateAiApplicationDto } from './ai-application.dto.js';
import { AiConnectionVersionDto } from './ai-connection.dto.js';
import { AiApplicationService, aiApplicationInvocationPermissions } from './ai-application.service.js';

const readAccess = { featurePermission: 'ai:applications:read', organizationScope: { source: 'query' as const, field: 'organizationId', optional: true } };
const writeAccess = { ...readAccess, featurePermission: 'ai:applications:manage' };

@Controller('api/v1/admin/ai-applications')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class AiApplicationController {
  constructor(private readonly applications: AiApplicationService) {}
  @Get() @Header('Cache-Control', 'no-store') @RequireAccess(readAccess) @ApiOkResponse({ type: AiApplicationPageDto })
  list(@Query() query: AiApplicationQueryDto, @Req() request: AuthorizedRequest) { return this.applications.list(this.actor(request), request.authorizedOrganizationId!, query); }
  @Get(':id') @Header('Cache-Control', 'no-store') @RequireAccess(readAccess) @ApiOkResponse({ type: AiApplicationDto })
  read(@Param('id', ParseUUIDPipe) id: string, @Query() _query: AiApplicationQueryDto, @Req() request: AuthorizedRequest) { return this.applications.read(this.actor(request), request.authorizedOrganizationId!, id); }
  @Get(':id/revisions/:publishedVersion') @Header('Cache-Control', 'no-store') @RequireAccess(readAccess) @ApiOkResponse({ type: AiApplicationRevisionDto })
  readRevision(@Param('id', ParseUUIDPipe) id: string, @Param('publishedVersion', ParseIntPipe) publishedVersion: number, @Query() _query: AiApplicationQueryDto, @Req() request: AuthorizedRequest) { return this.applications.readRevision(this.actor(request), request.authorizedOrganizationId!, id, publishedVersion); }
  @Get(':id/invocations') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: AiApplicationInvocationPageDto })
  @RequireAccess({ ...readAccess, featurePermissions: () => aiApplicationInvocationPermissions })
  listInvocations(@Param('id', ParseUUIDPipe) id: string, @Query() query: AiApplicationQueryDto, @Req() request: AuthorizedRequest) { return this.applications.listInvocations(this.actor(request), request.authorizedOrganizationId!, id, query); }
  @Post() @Header('Cache-Control', 'no-store') @RequireAccess(writeAccess) @ApiCreatedResponse({ type: AiApplicationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  create(@Query() _query: AiApplicationQueryDto, @Body() input: AiApplicationSettingsDto, @Req() request: AuthorizedRequest) { return this.applications.create(this.actor(request), request.authorizedOrganizationId!, input, requestTraceId(request), request.get('Idempotency-Key')); }
  @Patch(':id') @Header('Cache-Control', 'no-store') @RequireAccess(writeAccess) @ApiOkResponse({ type: AiApplicationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  update(@Param('id', ParseUUIDPipe) id: string, @Query() _query: AiApplicationQueryDto, @Body() input: UpdateAiApplicationDto, @Req() request: AuthorizedRequest) { return this.applications.update(this.actor(request), request.authorizedOrganizationId!, id, input, requestTraceId(request), request.get('Idempotency-Key')); }
  @Post(':id/publish') @Header('Cache-Control', 'no-store') @RequireAccess({ ...readAccess, featurePermission: 'ai:applications:publish' }) @ApiCreatedResponse({ type: AiApplicationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  publish(@Param('id', ParseUUIDPipe) id: string, @Query() _query: AiApplicationQueryDto, @Body() input: AiConnectionVersionDto, @Req() request: AuthorizedRequest) { return this.applications.publish(this.actor(request), request.authorizedOrganizationId!, id, input, requestTraceId(request), request.get('Idempotency-Key')); }
  @Post(':id/test') @Header('Cache-Control', 'no-store') @RequireAccess({ ...readAccess, featurePermission: 'ai:applications:test' }) @ApiCreatedResponse({ type: AiApplicationTestResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'x-csrf-token', required: true })
  test(@Param('id', ParseUUIDPipe) id: string, @Query() _query: AiApplicationQueryDto, @Body() input: TestAiApplicationDto, @Req() request: AuthorizedRequest) { return this.applications.test(this.actor(request), request.authorizedOrganizationId!, id, input, requestTraceId(request), request.get('Idempotency-Key')); }
  private actor(request: AuthorizedRequest) { return { ...request[AUTHENTICATED_SESSION]!.user, sessionId: request[AUTHENTICATED_SESSION]!.id }; }
}
