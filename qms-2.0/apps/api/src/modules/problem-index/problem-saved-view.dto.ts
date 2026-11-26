import { ApiProperty, ApiPropertyOptional, IntersectionType, PartialType, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, Equals, IsArray, IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, Validate, ValidateIf, ValidateNested, ValidatorConstraint, type ValidationArguments, type ValidatorConstraintInterface } from 'class-validator';
import { ProblemIndexQueryDto, ProblemScopeQueryDto, ProcessFollowupQueryDto, PROBLEM_SORT_FIELDS } from './problem-index.dto.js';
import { ProcessFollowupFiltersDto } from './process-followup-filter.dto.js';

export const PROBLEM_VIEW_COLUMNS = ['reportNumber', 'title', 'domainCode', 'problemType', 'status', 'severity', 'responsibleParty', 'ownerId', 'dueAt', 'updatedAt', 'processStage'] as const;
type ProblemViewColumn = typeof PROBLEM_VIEW_COLUMNS[number];

export class ProblemSavedViewFiltersDto extends IntersectionType(
  PickType(ProblemIndexQueryDto, ['domainCode', 'problemType', 'status', 'severity', 'ownerId', 'search', 'dueFrom', 'dueTo', 'overdueAt'] as const),
  PickType(ProcessFollowupQueryDto, ['stage', 'responsibleSectionDepartmentId', 'responsibleSectionName', 'ownerName'] as const),
) {
  @ApiPropertyOptional({ type: ProcessFollowupFiltersDto }) @ValidateIf((_object, value) => value !== undefined) @IsObject() @ValidateNested() @Type(() => ProcessFollowupFiltersDto)
  processFollowupFilters?: ProcessFollowupFiltersDto;
}

export class ProblemSavedViewSortDto {
  @ApiProperty({ enum: PROBLEM_SORT_FIELDS }) @IsIn(PROBLEM_SORT_FIELDS) sortBy!: typeof PROBLEM_SORT_FIELDS[number];
  @ApiProperty({ enum: ['asc', 'desc'] }) @IsIn(['asc', 'desc']) sortDirection!: 'asc' | 'desc';
}

@ValidatorConstraint({ name: 'problemViewVisibleColumns', async: false })
class ProblemViewVisibleColumnsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, arguments_: ValidationArguments) {
    const order = (arguments_.object as { columnOrder?: unknown }).columnOrder;
    return Array.isArray(value) && Array.isArray(order) && value.every((column) => order.includes(column));
  }
}

@ValidatorConstraint({ name: 'problemViewFilterValues', async: false })
class ProblemViewFilterValuesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some((entry) => entry === null)) return false;
    const filters = value as ProblemSavedViewFiltersDto;
    return !filters.dueFrom || !filters.dueTo || new Date(filters.dueFrom) <= new Date(filters.dueTo);
  }
}

export class ProblemSavedViewConfigurationDto {
  @ApiProperty({ enum: [1] }) @Equals(1) schemaVersion!: 1;
  @ApiProperty({ type: ProblemSavedViewFiltersDto }) @IsDefined() @IsObject() @ValidateNested() @Validate(ProblemViewFilterValuesConstraint) @Type(() => ProblemSavedViewFiltersDto) filters!: ProblemSavedViewFiltersDto;
  @ApiProperty({ type: ProblemSavedViewSortDto }) @IsDefined() @IsObject() @ValidateNested() @Type(() => ProblemSavedViewSortDto) sort!: ProblemSavedViewSortDto;
  @ApiProperty({ type: [String], enum: PROBLEM_VIEW_COLUMNS, minItems: 1, maxItems: PROBLEM_VIEW_COLUMNS.length, uniqueItems: true }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(PROBLEM_VIEW_COLUMNS.length) @ArrayUnique() @IsIn(PROBLEM_VIEW_COLUMNS, { each: true }) @Validate(ProblemViewVisibleColumnsConstraint) visibleColumns!: ProblemViewColumn[];
  @ApiProperty({ type: [String], enum: PROBLEM_VIEW_COLUMNS, minItems: 1, maxItems: PROBLEM_VIEW_COLUMNS.length, uniqueItems: true }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(PROBLEM_VIEW_COLUMNS.length) @ArrayUnique() @IsIn(PROBLEM_VIEW_COLUMNS, { each: true }) columnOrder!: ProblemViewColumn[];
}

export class CreateProblemSavedViewDto {
  @ApiProperty({ maxLength: 100 }) @IsString() @Matches(/\S/) @MaxLength(100) name!: string;
  @ApiProperty({ type: ProblemSavedViewConfigurationDto }) @IsDefined() @IsObject() @ValidateNested() @Type(() => ProblemSavedViewConfigurationDto) configuration!: ProblemSavedViewConfigurationDto;
}

export class UpdateProblemSavedViewDto extends PartialType(CreateProblemSavedViewDto, { skipNullProperties: false }) {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}

export class DeleteProblemSavedViewDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}

export class ProblemSavedViewQueryDto extends ProblemScopeQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset?: number;
}

export class ProblemSavedViewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: ProblemSavedViewConfigurationDto }) configuration!: ProblemSavedViewConfigurationDto;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class ProblemSavedViewPageDto {
  @ApiProperty({ type: [ProblemSavedViewDto] }) items!: ProblemSavedViewDto[];
  @ApiProperty() total!: number;
}

export class ProblemSavedViewDeletedDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: [true] }) deleted!: true;
}
