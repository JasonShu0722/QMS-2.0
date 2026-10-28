import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiResponse } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAccess } from '../authorization/access.decorator.js';
import { SupplierEightDAssignmentService } from './supplier-eight-d-assignment.service.js';

export class SupplierEightDAssignmentQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_object, value) => value !== undefined) @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 }) @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset = 0;
}
export class SupplierEightDAssignmentDto {
  @ApiProperty({ format: 'uuid' }) assignmentId!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ type: String, nullable: true }) fullName!: string | null;
  @ApiProperty() positionName!: string;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty() departmentName!: string;
}
export class SupplierEightDAssignmentPageDto {
  @ApiProperty({ type: [SupplierEightDAssignmentDto] }) items!: SupplierEightDAssignmentDto[];
  @ApiProperty() total!: number;
}

@Controller('api/v1/supplier-quality/eight-d')
@ApiCookieAuth('qms_session') @ApiResponse({ status: 'default', type: ErrorResponse })
export class SupplierEightDAssignmentController {
  constructor(private readonly service: SupplierEightDAssignmentService) {}
  @Get('assignment-options') @ApiOkResponse({ type: SupplierEightDAssignmentPageDto })
  @RequireAccess({ featurePermission: 'supplier-quality:issues:issue', organizationScope: { source: 'session', optional: true } })
  list(@Req() request: AuthorizedRequest, @Query() query: SupplierEightDAssignmentQueryDto) {
    const session = request[AUTHENTICATED_SESSION]!;
    return this.service.list({ ...session.user, sessionId: session.id, scopeOrganizationId: request.authorizedOrganizationId }, query);
  }
}
