import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Allow, ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf, ValidateNested } from 'class-validator';

export const COMPONENT_PROJECT_STAGES = ['NEW_PRODUCT', 'MASS_PRODUCTION'] as const;
export const COMPONENT_PROJECT_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type ComponentProjectStage = typeof COMPONENT_PROJECT_STAGES[number];
export type ComponentProjectStatus = typeof COMPONENT_PROJECT_STATUSES[number];
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class ComponentProjectScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}

export class ComponentProjectListQueryDto extends ComponentProjectScopeDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) page = 1;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @Transform(trim) @IsString() @Length(0, 200) search?: string;
  @ApiPropertyOptional({ enum: COMPONENT_PROJECT_STATUSES }) @IsOptional() @IsIn(COMPONENT_PROJECT_STATUSES) status?: ComponentProjectStatus;
}

export class ComponentEngineerAssignmentsQueryDto extends ComponentProjectListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() selectedAssignmentId?: string;
}

export class ResolveComponentProjectQueryDto extends ComponentProjectScopeDto {
  @ApiProperty({ maxLength: 100 }) @Transform(trim) @IsString() @Length(1, 100) componentCode!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String }) @IsOptional() @IsUUID() currentQualityEngineerId?: string | null;
  @ApiPropertyOptional({ enum: ['MANUAL', 'MAPPING'] }) @IsOptional() @IsIn(['MANUAL', 'MAPPING']) currentQualityEngineerSource?: 'MANUAL' | 'MAPPING';
}

export class CreateComponentProjectRecordDto {
  @ApiProperty({ maxLength: 100 }) @Transform(trim) @IsString() @Length(1, 100) code!: string;
  @ApiProperty({ maxLength: 200 }) @Transform(trim) @IsString() @Length(1, 200) name!: string;
  @ApiProperty({ enum: COMPONENT_PROJECT_STAGES }) @IsIn(COMPONENT_PROJECT_STAGES) stage!: ComponentProjectStage;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String }) @IsOptional() @IsUUID() customerEngineerAssignmentId?: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String }) @IsOptional() @IsUUID() projectEngineerAssignmentId?: string | null;
  @ApiPropertyOptional({ enum: COMPONENT_PROJECT_STATUSES }) @ValidateIf((_o, value) => value !== undefined) @IsIn(COMPONENT_PROJECT_STATUSES) status?: ComponentProjectStatus;
}

export class UpdateComponentProjectRecordDto extends PartialType(CreateComponentProjectRecordDto, { skipNullProperties: false }) {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}

export class CreateComponentProjectMappingDto {
  @ApiProperty({ maxLength: 100 }) @Transform(trim) @IsString() @Length(1, 100) componentCode!: string;
  @ApiPropertyOptional({ maxLength: 200, nullable: true, type: String }) @IsOptional() @Transform(trim) @IsString() @Length(1, 200) componentName?: string | null;
  @ApiProperty({ format: 'uuid' }) @IsUUID() projectRecordId!: string;
  @ApiProperty({ maxLength: 100 }) @Transform(trim) @IsString() @Length(1, 100) productCategory!: string;
  @ApiPropertyOptional({ maxLength: 100, nullable: true, type: String }) @IsOptional() @Transform(trim) @IsString() @Length(1, 100) productSubcategory?: string | null;
  @ApiPropertyOptional({ enum: COMPONENT_PROJECT_STATUSES }) @ValidateIf((_o, value) => value !== undefined) @IsIn(COMPONENT_PROJECT_STATUSES) status?: ComponentProjectStatus;
}

export class UpdateComponentProjectMappingDto extends PartialType(CreateComponentProjectMappingDto, { skipNullProperties: false }) {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}

class ComponentProjectAuditDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ enum: COMPONENT_PROJECT_STATUSES }) status!: ComponentProjectStatus;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) createdByUserId!: string;
  @ApiProperty({ format: 'uuid' }) updatedByUserId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class ComponentProjectRecordDto extends ComponentProjectAuditDto {
  @ApiProperty({ maxLength: 100 }) code!: string;
  @ApiProperty({ maxLength: 200 }) name!: string;
  @ApiProperty({ enum: COMPONENT_PROJECT_STAGES }) stage!: ComponentProjectStage;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) customerEngineerAssignmentId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) projectEngineerAssignmentId!: string | null;
}

export class ComponentEngineerAssignmentDto {
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) assignmentId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) userId!: string | null;
  @ApiProperty({ type: String, nullable: true }) username!: string | null;
  @ApiProperty({ type: String, nullable: true }) fullName!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) positionId!: string | null;
  @ApiProperty({ type: String, nullable: true }) positionName!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) departmentId!: string | null;
  @ApiProperty({ type: String, nullable: true }) departmentName!: string | null;
  @ApiProperty() valid!: boolean;
  @ApiProperty({ type: [String] }) issues!: string[];
}

export class ComponentProjectSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: COMPONENT_PROJECT_STAGES }) stage!: ComponentProjectStage;
  @ApiProperty({ enum: COMPONENT_PROJECT_STATUSES }) status!: ComponentProjectStatus;
  @ApiProperty({ type: ComponentEngineerAssignmentDto }) customerEngineer!: ComponentEngineerAssignmentDto;
  @ApiProperty({ type: ComponentEngineerAssignmentDto }) projectEngineer!: ComponentEngineerAssignmentDto;
}

export class ComponentProjectMappingDto extends ComponentProjectAuditDto {
  @ApiProperty({ maxLength: 100 }) componentCode!: string;
  @ApiProperty({ maxLength: 200, type: String, nullable: true }) componentName!: string | null;
  @ApiProperty({ format: 'uuid', type: String, nullable: true }) projectRecordId!: string | null;
  @ApiProperty({ maxLength: 100, type: String, nullable: true }) productCategory!: string | null;
  @ApiProperty({ maxLength: 100, type: String, nullable: true }) productSubcategory!: string | null;
}

export class ComponentProjectMappingListItemDto extends ComponentProjectMappingDto {
  @ApiProperty({ type: ComponentProjectSummaryDto, nullable: true }) project!: ComponentProjectSummaryDto | null;
}

export class ComponentProjectImportRowDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) rowNumber!: number;
  // Content failures belong to a row receipt, not to whole-batch validation.
  @ApiProperty({ type: String, maxLength: 100 }) @Allow() componentCode!: unknown;
  @ApiProperty({ type: String, maxLength: 200 }) @Allow() componentName!: unknown;
}

export class ComponentProjectImportDto extends ComponentProjectScopeDto {
  @ApiProperty({ type: [ComponentProjectImportRowDto], minItems: 1, maxItems: 100 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique((row: ComponentProjectImportRowDto | null) => row?.rowNumber)
  @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => ComponentProjectImportRowDto)
  rows!: ComponentProjectImportRowDto[];
}

export class ComponentProjectImportItemDto {
  @ApiProperty() rowNumber!: number;
  @ApiProperty() code!: string;
  @ApiProperty({ enum: ['CREATED', 'SKIPPED_DUPLICATE', 'FAILED'] }) status!: 'CREATED' | 'SKIPPED_DUPLICATE' | 'FAILED';
  @ApiPropertyOptional() errorCode?: string;
}

export class ComponentProjectImportResultDto {
  @ApiProperty({ type: [ComponentProjectImportItemDto] }) items!: ComponentProjectImportItemDto[];
  @ApiProperty() created!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty() failed!: number;
}

class ComponentProjectPageDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ComponentProjectRecordsPageDto extends ComponentProjectPageDto {
  @ApiProperty({ type: [ComponentProjectRecordDto] }) items!: ComponentProjectRecordDto[];
}

export class ComponentProjectMappingsPageDto extends ComponentProjectPageDto {
  @ApiProperty({ type: [ComponentProjectMappingListItemDto] }) items!: ComponentProjectMappingListItemDto[];
}

export class ComponentEngineerAssignmentsPageDto extends ComponentProjectPageDto {
  @ApiProperty({ type: [ComponentEngineerAssignmentDto] }) items!: ComponentEngineerAssignmentDto[];
  @ApiProperty({ type: ComponentEngineerAssignmentDto, nullable: true }) selected!: ComponentEngineerAssignmentDto | null;
}

export class ComponentProjectResolutionDto {
  @ApiProperty({ enum: ['matched', 'unmapped', 'inactive'] }) outcome!: 'matched' | 'unmapped' | 'inactive';
  @ApiProperty() componentCode!: string;
  @ApiProperty({ type: ComponentProjectMappingDto, nullable: true }) mapping!: ComponentProjectMappingDto | null;
  @ApiProperty({ type: ComponentProjectRecordDto, nullable: true }) project!: ComponentProjectRecordDto | null;
  @ApiProperty({ type: ComponentEngineerAssignmentDto }) customerEngineer!: ComponentEngineerAssignmentDto;
  @ApiProperty({ type: ComponentEngineerAssignmentDto }) projectEngineer!: ComponentEngineerAssignmentDto;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) suggestedQualityEngineerId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) effectiveQualityEngineerId!: string | null;
  @ApiProperty() engineerDifference!: boolean;
  @ApiProperty({ type: [String] }) issues!: string[];
}
