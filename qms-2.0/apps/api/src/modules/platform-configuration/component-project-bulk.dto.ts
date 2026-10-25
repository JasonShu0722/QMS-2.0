import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateBy, ValidateIf, ValidateNested } from 'class-validator';
import { COMPONENT_PROJECT_STAGES, COMPONENT_PROJECT_STATUSES, type ComponentProjectStage, type ComponentProjectStatus } from './component-project.dto.js';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const uuid = ({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase() : value;

export class ComponentProjectBulkSelectionDto {
  @ApiProperty({ format: 'uuid' }) @Transform(uuid) @IsUUID() id!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}

export class ComponentProjectBulkChangesDto {
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_o, value) => value !== undefined) @Transform(uuid) @IsUUID() projectRecordId?: string;
  @ApiPropertyOptional({ enum: COMPONENT_PROJECT_STAGES }) @ValidateIf((_o, value) => value !== undefined) @IsIn(COMPONENT_PROJECT_STAGES) stage?: ComponentProjectStage;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String }) @IsOptional() @Transform(uuid) @IsUUID() customerEngineerAssignmentId?: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String }) @IsOptional() @Transform(uuid) @IsUUID() projectEngineerAssignmentId?: string | null;
  @ApiPropertyOptional({ maxLength: 100 }) @ValidateIf((_o, value) => value !== undefined) @Transform(trim) @IsString() @Length(1, 100) productCategory?: string;
  @ApiPropertyOptional({ maxLength: 100, nullable: true, type: String }) @IsOptional() @Transform(trim) @IsString() @Length(1, 100) productSubcategory?: string | null;
}

export class ComponentProjectBulkPreviewDto {
  @ApiProperty({ type: [ComponentProjectBulkSelectionDto], minItems: 1, maxItems: 100 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique((item: ComponentProjectBulkSelectionDto) => item?.id)
  @ValidateNested({ each: true }) @Type(() => ComponentProjectBulkSelectionDto) selection!: ComponentProjectBulkSelectionDto[];

  @ApiProperty({ type: ComponentProjectBulkChangesDto }) @IsObject()
  @ValidateBy({ name: 'hasBulkChanges', validator: { validate: (value: unknown) => !!value && typeof value === 'object' && Object.values(value).some((field) => field !== undefined) } })
  @ValidateNested() @Type(() => ComponentProjectBulkChangesDto) changes!: ComponentProjectBulkChangesDto;
}

export class ComponentProjectBulkApplyDto extends ComponentProjectBulkPreviewDto {
  @ApiProperty({ pattern: '^[a-f0-9]{64}$', description: 'Configuration snapshot fingerprint, not an authorization token.' })
  @IsString() @Matches(/^[a-f0-9]{64}$/) previewToken!: string;
}

export class ComponentProjectBulkAffectedProjectDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: COMPONENT_PROJECT_STAGES }) stage!: ComponentProjectStage;
  @ApiProperty({ enum: COMPONENT_PROJECT_STATUSES }) status!: ComponentProjectStatus;
  @ApiProperty() version!: number;
  @ApiProperty() selectedComponentCount!: number;
  @ApiProperty({ description: 'Component count after the proposed reassignment, including unselected components.' }) totalComponentCount!: number;
  @ApiProperty({ description: 'Unselected components sharing this project; shared edits affect these components too.' }) otherComponentCount!: number;
}

export class ComponentProjectBulkPreviewResultDto {
  @ApiProperty() selectedCount!: number;
  @ApiProperty() affectedMappingsCount!: number;
  @ApiProperty({ type: [ComponentProjectBulkAffectedProjectDto] }) affectedProjects!: ComponentProjectBulkAffectedProjectDto[];
  @ApiProperty({ pattern: '^[a-f0-9]{64}$' }) previewToken!: string;
}

export class ComponentProjectBulkApplyResultDto {
  @ApiProperty() updatedMappingCount!: number;
  @ApiProperty() updatedProjectCount!: number;
  @ApiProperty() affectedComponentCount!: number;
}
