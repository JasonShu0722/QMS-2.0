import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

export const MANAGEMENT_RESPONSIBILITIES = ['SECTION_MANAGER', 'MINISTER'] as const;
export type ManagementResponsibility = typeof MANAGEMENT_RESPONSIBILITIES[number];
export type ResponsibilityConfigurationStatus = 'ACTIVE' | 'DISABLED';

class ManagementPaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 100 }) @ValidateIf((_object, value) => value !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 }) @ValidateIf((_object, value) => value !== undefined) @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset?: number;
}

export class ManagementConfigurationQueryDto extends ManagementPaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_object, value) => value !== undefined) @IsUUID() departmentId?: string;
}

export class CreateManagementBindingDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() departmentId!: string;
  @ApiProperty({ enum: MANAGEMENT_RESPONSIBILITIES }) @IsIn(MANAGEMENT_RESPONSIBILITIES) responsibility!: ManagementResponsibility;
  @ApiProperty({ format: 'uuid' }) @IsUUID() positionId!: string;
}

export class UpdateManagementBindingDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_object, value) => value !== undefined) @IsUUID() positionId?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] }) @ValidateIf((_object, value) => value !== undefined) @IsIn(['ACTIVE', 'DISABLED']) status?: ResponsibilityConfigurationStatus;
}

export class CreateMinisterScopeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() departmentId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() sectionDepartmentId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() ministerAssignmentId!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String, description: 'Defaults to the transaction time; explicit bounds must fit the appointment.' })
  @ValidateIf((_object, value) => value !== undefined) @IsDateString({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) validFrom?: string;
  @ApiPropertyOptional({ format: 'date-time', type: String, nullable: true, description: 'Exclusive upper bound; null is unbounded.' })
  @ValidateIf((_object, value) => value !== undefined && value !== null) @IsDateString({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) validTo?: string | null;
}

export class UpdateMinisterScopeDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_object, value) => value !== undefined) @IsUUID() sectionDepartmentId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_object, value) => value !== undefined) @IsUUID() ministerAssignmentId?: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) @ValidateIf((_object, value) => value !== undefined) @IsDateString({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) validFrom?: string;
  @ApiPropertyOptional({ format: 'date-time', type: String, nullable: true }) @ValidateIf((_object, value) => value !== undefined && value !== null) @IsDateString({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) validTo?: string | null;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] }) @ValidateIf((_object, value) => value !== undefined) @IsIn(['ACTIVE', 'DISABLED']) status?: ResponsibilityConfigurationStatus;
}

export class ManagementResponsibilitiesQueryDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() sectionDepartmentId!: string;
}

export class ResponsibilityAssignmentsQueryDto extends ManagementPaginationQueryDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() departmentId!: string;
  @ApiPropertyOptional({ maxLength: 200 }) @ValidateIf((_object, value) => value !== undefined) @IsString() @Length(0, 200) search?: string;
}

export class ManagementBindingDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty({ enum: MANAGEMENT_RESPONSIBILITIES }) responsibility!: ManagementResponsibility;
  @ApiProperty({ format: 'uuid' }) positionId!: string;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) status!: ResponsibilityConfigurationStatus;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty({ format: 'uuid' }) updatedBy!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class MinisterScopeDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty({ format: 'uuid' }) sectionDepartmentId!: string;
  @ApiProperty({ format: 'uuid' }) ministerAssignmentId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) validFrom!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) validTo!: Date | null;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) status!: ResponsibilityConfigurationStatus;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty({ format: 'uuid' }) updatedBy!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class ResponsibilityAssignmentDto {
  @ApiProperty({ format: 'uuid' }) assignmentId!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ type: String, nullable: true }) fullName!: string | null;
  @ApiProperty({ format: 'uuid' }) positionId!: string;
  @ApiProperty() positionName!: string;
  @ApiProperty() positionVersion!: number;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) startedAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endedAt!: Date | null;
}

export class ResponsibilityAssignmentsDto {
  @ApiProperty({ type: [ResponsibilityAssignmentDto] }) items!: ResponsibilityAssignmentDto[];
  @ApiProperty() total!: number;
}

export class ResolvedManagementResponsibilityDto extends ResponsibilityAssignmentDto {
  @ApiProperty({ enum: MANAGEMENT_RESPONSIBILITIES }) responsibility!: ManagementResponsibility;
  @ApiProperty({ format: 'uuid' }) bindingId!: string;
  @ApiProperty() bindingVersion!: number;
  @ApiProperty({ format: 'uuid', type: String, nullable: true }) scopeId!: string | null;
  @ApiProperty({ type: Number, nullable: true }) scopeVersion!: number | null;
  @ApiProperty() departmentVersion!: number;
  @ApiProperty() sectionDepartmentVersion!: number;
  @ApiProperty() organizationVersion!: number;
}

export const MANAGEMENT_RESPONSIBILITY_ISSUES = ['STRUCTURE_INACTIVE', 'BINDING_MISSING', 'BINDING_AMBIGUOUS', 'ASSIGNMENT_MISSING', 'ASSIGNMENT_AMBIGUOUS', 'SCOPE_MISSING', 'SCOPE_AMBIGUOUS'] as const;

export class ManagementResponsibilityIssueDto {
  @ApiProperty({ enum: MANAGEMENT_RESPONSIBILITIES }) responsibility!: ManagementResponsibility;
  @ApiProperty({ enum: MANAGEMENT_RESPONSIBILITY_ISSUES }) code!: typeof MANAGEMENT_RESPONSIBILITY_ISSUES[number];
}

export class ManagementResponsibilitiesDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) sectionDepartmentId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) at!: Date;
  @ApiProperty({ type: [ResolvedManagementResponsibilityDto] }) responsibilities!: ResolvedManagementResponsibilityDto[];
  @ApiProperty({ type: [ManagementResponsibilityIssueDto] }) issues!: ManagementResponsibilityIssueDto[];
}
