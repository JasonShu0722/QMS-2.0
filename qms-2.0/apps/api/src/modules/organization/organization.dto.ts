import { ApiProperty } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { AdminRoleDto } from '../authorization/admin-role.dto.js';

export class OrganizationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['INTERNAL', 'SUPPLIER'] })
  type!: 'INTERNAL' | 'SUPPLIER';

  @ApiProperty({ type: String, nullable: true })
  parentId!: string | null;

  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  status!: 'ACTIVE' | 'DISABLED';

  @ApiProperty()
  version!: number;
}

export class OrganizationListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 10000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset?: number;
}

export class CreateOrganizationDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @Length(1, 64) @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/) code!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @Length(1, 200) @Matches(/\S/) name!: string;
}

export class UpdateOrganizationDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiPropertyOptional({ maxLength: 64 }) @ValidateIf((_object, value) => value !== undefined) @IsString() @Length(1, 64) @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/) code?: string;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @Length(1, 200) @Matches(/\S/) name?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_object, value) => value !== undefined) @IsUUID() parentId?: string;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', description: 'Required when moving; the original parent, or null for a root organization' })
  @ValidateIf((object: UpdateOrganizationDto, value) => (object.parentId !== undefined || value !== undefined) && value !== null) @IsUUID() expectedParentId?: string | null;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] }) @ValidateIf((_object, value) => value !== undefined) @IsIn(['ACTIVE', 'DISABLED']) status?: 'ACTIVE' | 'DISABLED';
}

export class CreateDepartmentDto extends CreateOrganizationDto {
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) @IsOptional() @IsUUID() parentId?: string | null;
}

export class UpdateDepartmentDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiPropertyOptional({ maxLength: 64 }) @ValidateIf((_object, value) => value !== undefined) @IsString() @Length(1, 64) @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/) code?: string;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @Length(1, 200) @Matches(/\S/) name?: string;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) @IsOptional() @IsUUID() parentId?: string | null;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] }) @ValidateIf((_object, value) => value !== undefined) @IsIn(['ACTIVE', 'DISABLED']) status?: 'ACTIVE' | 'DISABLED';
}

export class OrganizationLifecycleBlockerDto {
  @ApiProperty() code!: string;
  @ApiProperty({ minimum: 1 }) count!: number;
  @ApiProperty() message!: string;
}

export class OrganizationLifecycleDto {
  @ApiProperty({ type: [String] }) deleteBlockers!: string[];
  @ApiProperty({ type: [String] }) disableBlockers!: string[];
  @ApiPropertyOptional({ type: [OrganizationLifecycleBlockerDto] }) deleteBlockerDetails?: OrganizationLifecycleBlockerDto[];
  @ApiPropertyOptional({ type: [OrganizationLifecycleBlockerDto] }) disableBlockerDetails?: OrganizationLifecycleBlockerDto[];
}

export class DeleteStructureDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class DeleteStructureResultDto {
  @ApiProperty() id!: string;
  @ApiProperty() deleted!: boolean;
}

export class CreatePositionDto extends CreateOrganizationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() departmentId!: string;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) @IsOptional() @IsUUID() categoryId?: string | null;
}

export class UpdatePositionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @Length(1, 200) @Matches(/\S/) name?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_object, value) => value !== undefined) @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) @IsOptional() @IsUUID() categoryId?: string | null;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] }) @ValidateIf((_object, value) => value !== undefined) @IsIn(['ACTIVE', 'DISABLED']) status?: 'ACTIVE' | 'DISABLED';
}

export class ReplaceUserPositionsDto {
  @ApiProperty({ type: [String], maxItems: 100 }) @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all', { each: true }) positionIds!: string[];
  @ApiProperty({ type: [String], maxItems: 100 }) @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all', { each: true }) expectedPositionIds!: string[];
}

export class ReplaceUserPositionsWithPreviewDto extends ReplaceUserPositionsDto {
  @ApiProperty({ minLength: 1, maxLength: 256, description: '岗位授权预览返回的完整基线。' })
  @IsString() @Length(1, 256)
  authorizationBaseline!: string;
}

export class ReplacePositionRolesDto {
  @ApiProperty({ type: [String], maxItems: 100 }) @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all', { each: true }) roleIds!: string[];
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedRoleVersion!: number;
}

export class PositionRolesDto {
  @ApiProperty() positionId!: string;
  @ApiProperty() roleVersion!: number;
  @ApiProperty({ type: [AdminRoleDto] }) roles!: AdminRoleDto[];
  @ApiProperty({ description: 'Distinct users with currently effective appointments' }) effectiveAssigneeCount!: number;
  @ApiProperty({ description: 'The committed mutation invalidated the acting session; reauthenticate without resubmitting' }) selfSessionRevoked!: boolean;
}

export class UpdatePositionPermissionsDto {
  @ApiProperty({ type: [String], maxItems: 500 }) @IsArray() @ArrayMaxSize(500) @ArrayUnique() @IsString({ each: true }) @Length(1, 150, { each: true }) permissionCodes!: string[];
  @ApiProperty({ type: [String], maxItems: 500 }) @IsArray() @ArrayMaxSize(500) @ArrayUnique() @IsString({ each: true }) @Length(1, 150, { each: true }) expectedPermissionCodes!: string[];
  @ApiProperty() @IsBoolean() mfaRequired!: boolean;
  @ApiProperty() @IsBoolean() expectedMfaRequired!: boolean;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedRoleVersion!: number;
}

export class PositionPermissionsDto {
  @ApiProperty() positionId!: string;
  @ApiProperty() roleVersion!: number;
  @ApiProperty({ type: [String] }) permissionCodes!: string[];
  @ApiProperty() mfaRequired!: boolean;
  @ApiProperty({ type: [AdminRoleDto] }) legacyRoles!: AdminRoleDto[];
  @ApiProperty({ description: 'Distinct users with currently effective appointments' }) effectiveAssigneeCount!: number;
  @ApiProperty({ description: 'The committed mutation invalidated the acting session; reauthenticate without resubmitting' }) selfSessionRevoked!: boolean;
}

export class DepartmentDto {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty({ type: String, nullable: true }) parentId!: string | null;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) status!: 'ACTIVE' | 'DISABLED';
  @ApiProperty() version!: number;
}

export class PositionDto {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() departmentId!: string;
  @ApiProperty({ type: String, nullable: true }) categoryId!: string | null;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) status!: 'ACTIVE' | 'DISABLED';
  @ApiProperty() version!: number;
}

export class UserPositionDto {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() positionId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) startedAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endedAt!: Date | null;
  @ApiProperty({ type: PositionDto }) position!: PositionDto;
}

export class CurrentOrganizationResponseDto {
  @ApiProperty({ type: OrganizationDto })
  organization!: OrganizationDto;

  @ApiProperty()
  userId!: string;
}
