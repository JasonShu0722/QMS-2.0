import { ApiProperty } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

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
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @Length(1, 200) @Matches(/\S/) name?: string;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) @IsOptional() @IsUUID() parentId?: string | null;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] }) @ValidateIf((_object, value) => value !== undefined) @IsIn(['ACTIVE', 'DISABLED']) status?: 'ACTIVE' | 'DISABLED';
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
