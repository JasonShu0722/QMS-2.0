import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiResponse } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { SupplierEightDRevisionService } from './supplier-eight-d-revision.service.js';

export class SupplierEightDRevisionQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @ApiPropertyOptional({ minimum: 1, maximum: 2147483647 }) @ValidateIf((_object, value) => value !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) before?: number;
}
export class SupplierEightDRevisionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() revision!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty() approved!: boolean;
}
export class SupplierEightDRevisionPageDto {
  @ApiProperty({ type: [SupplierEightDRevisionDto] }) items!: SupplierEightDRevisionDto[];
  @ApiProperty({ type: Number, nullable: true }) nextBefore!: number | null;
}
function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id, scopeOrganizationId: request.authorizedOrganizationId };
}

@Controller('api/v1/supplier-quality/eight-d')
@ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierEightDRevisionController {
  constructor(private readonly service: SupplierEightDRevisionService) {}
  @Get(':id/revisions') @ApiOkResponse({ type: SupplierEightDRevisionPageDto })
  @Header('Cache-Control', 'no-store') @RequireAccess({ featurePermission: 'supplier-quality:issues:report', organizationScope: { source: 'session', optional: true } })
  list(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Query() query: SupplierEightDRevisionQueryDto) {
    return this.service.list(actor(request), id, query);
  }
}

@Controller('api/v1/supplier-portal/eight-d')
@ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierPortalEightDRevisionController extends SupplierEightDRevisionController {
  @Get(':id/revisions') @ApiOkResponse({ type: SupplierEightDRevisionPageDto })
  @Header('Cache-Control', 'no-store') @RequireAccess({ featurePermission: 'supplier-quality:responses:read', organizationScope: { source: 'session', optional: true } })
  override list(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string, @Query() query: SupplierEightDRevisionQueryDto) {
    return super.list(request, id, query);
  }
}
