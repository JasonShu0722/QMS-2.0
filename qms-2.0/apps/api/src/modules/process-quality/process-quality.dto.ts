import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { AiDescriptionInputSnapshotDto } from '../../common/contracts/ai-description.dto.js';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDate, IsIn, IsInt, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { PROCESS_FILTER_FIELDS, PROCESS_FILTER_MAX_ITEMS, PROCESS_FILTER_MAX_LENGTH, PROCESS_FILTER_OPERATORS, PROCESS_MATERIAL_VERIFICATIONS, PROCESS_RESPONSIBILITY_CATEGORIES, type ProcessMaterialVerification, type ProcessResponsibilityCategory } from './process-defect-ledger.service.js';

import { ComponentProjectMappingDto, ComponentProjectRecordDto } from '../platform-configuration/component-project.dto.js';

export class ProcessScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}

export class ProcessOperationSectorInputDto extends ProcessScopeDto {
  @ApiProperty({ type: String, maxLength: 100 }) @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @IsNotEmpty() @MaxLength(100) operationCode?: string | null;
  @ApiProperty({ maxLength: 200 }) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @IsNotEmpty() @MaxLength(200) operationName!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) sectorName?: string | null;
}

export class UpdateProcessOperationSectorDto extends ProcessScopeDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) operationCode?: string | null;
  @ApiProperty({ maxLength: 200 }) @IsString() @IsNotEmpty() @MaxLength(200) operationName!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) sectorName?: string | null;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @ApiProperty() @IsBoolean() active!: boolean;
}

class CreateProcessOperationSectorItemDto {
  @ApiProperty({ maxLength: 100 }) operationCode!: string;
  @ApiProperty({ maxLength: 200 }) operationName!: string;
}

export class BulkCreateProcessOperationSectorsDto extends ProcessScopeDto {
  @ApiProperty({ type: [CreateProcessOperationSectorItemDto], minItems: 1, maxItems: 100 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) items!: CreateProcessOperationSectorItemDto[];
}

export class DeleteProcessOperationSectorDto extends ProcessScopeDto {
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}

export class ProcessOperationSectorDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String, nullable: true }) operationCode!: string | null;
  @ApiProperty() operationName!: string;
  @ApiProperty({ type: String, nullable: true }) sectorName!: string | null;
  @ApiProperty() active!: boolean;
  @ApiProperty() version!: number;
}

export class DeletedProcessOperationSectorDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}

export class CreateProcessDefectTypeDto extends ProcessScopeDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @MaxLength(64) code!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) name!: string;
}

export class ProcessDefectTypeDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty() version!: number;
}

export class UpdateProcessDefectTypeDto extends ProcessScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) name!: string;
  @ApiProperty() @IsBoolean() active!: boolean;
}

export class ProcessDefectMaterialInputDto {
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_, value) => value !== undefined) @IsUUID() id?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) materialCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) materialName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) @IsOptional() @IsUUID() supplierOrganizationId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) @IsOptional() @IsUUID() supplierProfileId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) materialBatch?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) @IsOptional() @IsUUID() sqeUserId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class CreateProcessDefectDto extends ProcessScopeDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 64 }) @IsOptional() @IsString() @MaxLength(64) defectTypeCode?: string | null;
  @ApiProperty({ maxLength: 10000 }) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @IsNotEmpty() @MaxLength(10000) description!: string;
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) defectQuantity = 1;
  @ApiProperty({ type: Date, format: 'date-time' }) @Type(() => Date) @IsDate() occurredAt!: Date;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) batchCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) workOrderCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) operationCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) lineCode?: string | null;
  @ApiProperty({ maxLength: 100 }) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @IsNotEmpty() @MaxLength(100) productCode!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) lineName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) operationName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) materialCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) @IsOptional() @IsUUID() supplierOrganizationId?: string | null;
  @ApiPropertyOptional({ type: String, enum: PROCESS_RESPONSIBILITY_CATEGORIES, nullable: true }) @IsOptional() @IsIn(PROCESS_RESPONSIBILITY_CATEGORIES) responsibilityCategory?: ProcessResponsibilityCategory | null;
  @ApiProperty({ maxLength: 200 }) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @IsNotEmpty() @MaxLength(200) traceCode!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 10000 }) @IsOptional() @IsString() @MaxLength(10000) analysisProgress?: string | null;
  @ApiPropertyOptional({ type: [ProcessDefectMaterialInputDto], maxItems: 100 }) @ValidateIf((_, value) => value !== undefined) @IsArray() @ArrayMaxSize(100) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => ProcessDefectMaterialInputDto) materials?: ProcessDefectMaterialInputDto[];
  @ApiPropertyOptional({ enum: ['MES', 'IMS'], description: '人工登记的外部来源标识；接口尚未启用' }) @IsOptional() @IsIn(['MES', 'IMS']) externalSourceSystem?: 'MES' | 'IMS';
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) externalRecordKey?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() sourceObservedAt?: Date;
}

export class UpdateProcessDefectDto extends ProcessScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 64 }) @IsOptional() @IsString() @MaxLength(64) defectTypeCode?: string | null;
  @ApiPropertyOptional({ maxLength: 10000 }) @ValidateIf((_, value) => value !== undefined) @IsString() @MaxLength(10000) description?: string;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 2147483647 }) @IsOptional() @IsInt() @Min(1) @Max(2147483647) defectQuantity?: number | null;
  @ApiPropertyOptional({ type: Date, nullable: true, format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() occurredAt?: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) batchCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) workOrderCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) operationCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) lineCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) lineName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) operationName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) projectCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) productCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) materialCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' }) @IsOptional() @IsUUID() supplierOrganizationId?: string | null;
  @ApiPropertyOptional({ type: String, enum: PROCESS_RESPONSIBILITY_CATEGORIES, nullable: true }) @IsOptional() @IsIn(PROCESS_RESPONSIBILITY_CATEGORIES) responsibilityCategory?: ProcessResponsibilityCategory | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) traceCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 10000 }) @IsOptional() @IsString() @MaxLength(10000) analysisProgress?: string | null;
  @ApiPropertyOptional({ type: [ProcessDefectMaterialInputDto], maxItems: 100 }) @ValidateIf((_, value) => value !== undefined) @IsArray() @ArrayMaxSize(100) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => ProcessDefectMaterialInputDto) materials?: ProcessDefectMaterialInputDto[];
  @ApiPropertyOptional({ maxLength: 200, description: '仅为尚未标识的IMS记录补充来源编号' }) @ValidateIf((_, value) => value !== undefined) @IsString() @IsNotEmpty() @MaxLength(200) externalRecordKey?: string;
}

export class ArchiveProcessDefectDto extends ProcessScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}

export class CloseProcessDefectDto extends ArchiveProcessDefectDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) reason?: string | null;
}

export class ReopenProcessDefectDto extends ArchiveProcessDefectDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 }) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @IsNotEmpty() @MaxLength(2000) reason!: string;
}

export class ProcessDefectSelectionDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() defectId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}

export class PreviewProcessDefectDeletionDto extends ProcessScopeDto {
  @ApiProperty({ type: [ProcessDefectSelectionDto], minItems: 1, maxItems: 100 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique((item: ProcessDefectSelectionDto | null) => typeof item?.defectId === 'string' ? item.defectId.toLowerCase() : item?.defectId) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => ProcessDefectSelectionDto) sources!: ProcessDefectSelectionDto[];
}

export class DeleteProcessDefectsDto extends PreviewProcessDefectDeletionDto {
  @ApiProperty({ minLength: 1, maxLength: 300 }) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;
}

export class DeleteLegacyProcessDefectDto extends ArchiveProcessDefectDto {
  @ApiProperty({ minLength: 1, maxLength: 300 }) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;
}

export class ProcessDefectDeletionBlockerDto {
  @ApiProperty() code!: string;
  @ApiProperty({ type: String, nullable: true }) reportNumber!: string | null;
}

export class ProcessDefectDeletionPreviewItemDto extends ProcessDefectSelectionDto {
  @ApiProperty() description!: string;
  @ApiProperty() blocked!: boolean;
  @ApiProperty({ type: [ProcessDefectDeletionBlockerDto] }) blockers!: ProcessDefectDeletionBlockerDto[];
}

export class ProcessDefectDeletionPreviewDto {
  @ApiProperty({ type: [ProcessDefectDeletionPreviewItemDto] }) items!: ProcessDefectDeletionPreviewItemDto[];
  @ApiProperty() count!: number;
  @ApiProperty() canDelete!: boolean;
}

export class ProcessDefectDeletionResultDto {
  @ApiProperty({ type: [String] }) deletedIds!: string[];
  @ApiProperty() count!: number;
}

export class ClassifyProcessDefectDto extends ArchiveProcessDefectDto {
  @ApiProperty({ type: String, enum: PROCESS_RESPONSIBILITY_CATEGORIES, nullable: true }) @ValidateIf((_, value) => value !== null) @IsIn(PROCESS_RESPONSIBILITY_CATEGORIES) responsibilityCategory!: ProcessResponsibilityCategory | null;
}

export class ClassifyProcessDefectsDto extends ProcessScopeDto {
  @ApiProperty({ type: [ProcessDefectSelectionDto], minItems: 1, maxItems: 100 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique((item: ProcessDefectSelectionDto | null) => item?.defectId) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => ProcessDefectSelectionDto) sources!: ProcessDefectSelectionDto[];
  @ApiProperty({ type: String, enum: PROCESS_RESPONSIBILITY_CATEGORIES, nullable: true }) @ValidateIf((_, value) => value !== null) @IsIn(PROCESS_RESPONSIBILITY_CATEGORIES) responsibilityCategory!: ProcessResponsibilityCategory | null;
}

export class VerifyProcessDefectMaterialDto extends ArchiveProcessDefectDto {
  @ApiProperty({ enum: PROCESS_MATERIAL_VERIFICATIONS.slice(1) }) @IsIn(PROCESS_MATERIAL_VERIFICATIONS.slice(1)) verification!: Exclude<ProcessMaterialVerification, 'UNREVIEWED'>;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) verificationNotes?: string | null;
}

export class ProcessMaterialSqeQueryDto extends ProcessScopeDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class ProcessMaterialSqeDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ type: String, nullable: true }) fullName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) departmentName?: string | null;
}

export class ProcessMaterialSqePageDto {
  @ApiProperty({ type: [ProcessMaterialSqeDto] }) items!: ProcessMaterialSqeDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ProcessDefectFilterDto {
  @ApiProperty({ enum: Object.keys(PROCESS_FILTER_FIELDS) }) field!: keyof typeof PROCESS_FILTER_FIELDS;
  @ApiProperty({ enum: [...new Set(Object.values(PROCESS_FILTER_OPERATORS).flat())] }) operator!: (typeof PROCESS_FILTER_OPERATORS)[keyof typeof PROCESS_FILTER_OPERATORS][number];
  @ApiPropertyOptional({ oneOf: [{ type: 'string' }, { type: 'integer' }, { type: 'boolean' }] }) value?: string | number | boolean;
}

export class ProcessDefectFiltersDto {
  @ApiProperty({ enum: ['ALL', 'ANY'] }) logic!: 'ALL' | 'ANY';
  @ApiProperty({ type: [ProcessDefectFilterDto], minItems: 1, maxItems: PROCESS_FILTER_MAX_ITEMS }) items!: ProcessDefectFilterDto[];
}

export class ProcessDefectQueryDto extends ProcessScopeDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ maxLength: 64 }) @IsOptional() @IsString() @MaxLength(64) defectTypeCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) batchCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) workOrderCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) operationCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) lineCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) projectCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) productCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) materialCode?: string;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) traceCode?: string;
  @ApiPropertyOptional({ enum: ['FOLLOWING', 'CLOSED'] }) @IsOptional() @IsIn(['FOLLOWING', 'CLOSED']) ledgerStatus?: 'FOLLOWING' | 'CLOSED';
  @ApiPropertyOptional({ enum: PROCESS_RESPONSIBILITY_CATEGORIES }) @IsOptional() @IsIn(PROCESS_RESPONSIBILITY_CATEGORIES) responsibilityCategory?: ProcessResponsibilityCategory;
  @ApiPropertyOptional({ default: false }) @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value) @IsOptional() @IsBoolean() includeArchived?: boolean;
  @ApiPropertyOptional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value) @IsOptional() @IsBoolean() pendingCompletion?: boolean;
  @ApiPropertyOptional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value) @IsOptional() @IsBoolean() pendingConfiguration?: boolean;
  @ApiPropertyOptional({ type: String, maxLength: PROCESS_FILTER_MAX_LENGTH, description: 'ProcessDefectFiltersDto 的 JSON 字符串；EMPTY、NOT_EMPTY 省略 value。', example: '{"logic":"ALL","items":[{"field":"projectStage","operator":"EQ","value":"NEW_PRODUCT"}]}' }) @IsOptional() @IsString() @MaxLength(PROCESS_FILTER_MAX_LENGTH) filters?: string;
  @ApiPropertyOptional({ format: 'date-time', description: '带明确时区的发生时间起点（含），独立于条件组。' }) @IsOptional() @IsISO8601({ strict: true }) occurredFrom?: string;
  @ApiPropertyOptional({ format: 'date-time', description: '带明确时区的发生时间终点（不含），独立于条件组。' }) @IsOptional() @IsISO8601({ strict: true }) occurredTo?: string;
}

export class ProcessDefectEvidenceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() originalName!: string;
  @ApiProperty() scanStatus!: string;
  @ApiProperty() status!: string;
}

export class ProcessDefectMaterialVerificationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) materialItemId!: string;
  @ApiProperty({ enum: PROCESS_MATERIAL_VERIFICATIONS.slice(1) }) verification!: Exclude<ProcessMaterialVerification, 'UNREVIEWED'>;
  @ApiProperty({ type: String, nullable: true }) verificationNotes!: string | null;
  @ApiProperty({ format: 'uuid' }) actorUserId!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: Date;
  @ApiProperty() defectVersion!: number;
  @ApiProperty({ type: ProcessDefectMaterialInputDto }) materialSnapshot!: ProcessDefectMaterialInputDto;
}

export class ProcessDefectMaterialDto extends ProcessDefectMaterialInputDto {
  @ApiProperty({ format: 'uuid' }) declare id: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) defectId!: string;
  @ApiProperty() position!: number;
  @ApiProperty({ enum: PROCESS_MATERIAL_VERIFICATIONS }) verification!: ProcessMaterialVerification;
  @ApiProperty({ type: String, nullable: true }) verificationNotes!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) verifiedById!: string | null;
  @ApiProperty({ type: Date, nullable: true, format: 'date-time' }) verifiedAt!: Date | null;
  @ApiProperty({ type: [ProcessDefectMaterialVerificationDto] }) verificationHistory!: ProcessDefectMaterialVerificationDto[];
}

export class ProcessDefectLedgerHistoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['FOLLOWING', 'CLOSED'] }) fromStatus!: string;
  @ApiProperty({ enum: ['FOLLOWING', 'CLOSED'] }) toStatus!: string;
  @ApiProperty({ format: 'uuid' }) actorUserId!: string;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ format: 'date-time' }) recordedAt!: Date;
  @ApiProperty() defectVersion!: number;
}

export class ProcessDefectClassificationHistoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, enum: PROCESS_RESPONSIBILITY_CATEGORIES, nullable: true }) previousCategory!: ProcessResponsibilityCategory | null;
  @ApiProperty({ type: String, enum: PROCESS_RESPONSIBILITY_CATEGORIES, nullable: true }) category!: ProcessResponsibilityCategory | null;
  @ApiProperty({ format: 'uuid' }) actorUserId!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: Date;
  @ApiProperty() defectVersion!: number;
}

export class ProcessDefectMappingSnapshotDto extends PickType(ComponentProjectMappingDto,
  ['id', 'version', 'status', 'componentCode', 'componentName', 'projectRecordId', 'productCategory', 'productSubcategory'] as const) {}

export class ProcessDefectProjectSnapshotDto extends PickType(ComponentProjectRecordDto,
  ['id', 'version', 'status', 'code', 'name', 'stage'] as const) {}

export class ProcessDefectProjectResolutionDto {
  @ApiProperty({ enum: ['matched'] }) outcome!: 'matched';
  @ApiProperty() componentCode!: string;
  @ApiProperty({ type: ProcessDefectMappingSnapshotDto }) mapping!: ProcessDefectMappingSnapshotDto;
  @ApiProperty({ type: ProcessDefectProjectSnapshotDto }) project!: ProcessDefectProjectSnapshotDto;
  @ApiProperty({ type: [String] }) issues!: string[];
}

export class ProcessDefectDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String, nullable: true }) defectTypeCode!: string | null;
  @ApiProperty() description!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) descriptionDirect?: string | null;
  @ApiPropertyOptional({ type: [AiDescriptionInputSnapshotDto], nullable: true }) descriptionInput?: AiDescriptionInputSnapshotDto[] | null;
  @ApiPropertyOptional({ type: String, nullable: true }) descriptionAi?: string | null;
  @ApiPropertyOptional({ enum: ['DISABLED','PENDING','PROCESSING','RETRY','FAILED','APPLIED','SUGGESTED','STALE'] }) descriptionAiStatus?: string;
  @ApiPropertyOptional({ enum: ['DIRECT','AI','MANUAL'] }) descriptionSource?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) descriptionTaskId?: string | null;
  @ApiProperty({ type: Number, nullable: true }) defectQuantity!: number | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) occurredAt!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) batchCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) workOrderCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) operationCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) lineCode?: string | null;
  @ApiProperty({ type: String, nullable: true }) lineName!: string | null;
  @ApiProperty({ type: String, nullable: true }) operationName!: string | null;
  @ApiProperty({ type: String, enum: ['DAY', 'NIGHT'], nullable: true }) shift!: 'DAY' | 'NIGHT' | null;
  @ApiProperty({ type: String, nullable: true }) operationSector!: string | null;
  @ApiProperty({ type: String, nullable: true }) productCategory!: string | null;
  @ApiProperty({ type: String, nullable: true }) productSubcategory!: string | null;
  @ApiProperty({ type: String, nullable: true }) projectName!: string | null;
  @ApiProperty({ type: String, enum: ['NEW_PRODUCT', 'MASS_PRODUCTION'], nullable: true }) projectStage!: 'NEW_PRODUCT' | 'MASS_PRODUCTION' | null;
  @ApiProperty() pendingCompletion!: boolean;
  @ApiProperty() pendingConfiguration!: boolean;
  @ApiProperty({ type: [String] }) registrationIssues!: string[];
  @ApiProperty({ type: String, nullable: true }) registeredByName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) projectCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) productCode?: string | null;
  @ApiProperty({ type: String, nullable: true }) traceCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) analysisProgress!: string | null;
  @ApiProperty({ enum: ['FOLLOWING', 'CLOSED'] }) ledgerStatus!: 'FOLLOWING' | 'CLOSED';
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) closedById!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) closedAt!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) materialCode?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) supplierOrganizationId?: string | null;
  @ApiProperty({ type: String, enum: PROCESS_RESPONSIBILITY_CATEGORIES, nullable: true }) responsibilityCategory!: ProcessResponsibilityCategory | null;
  @ApiProperty({ enum: ['MANUAL', 'IMS'] }) sourceKind!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) externalSourceSystem?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) externalRecordKey?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) sourceObservedAt?: string | null;
  @ApiPropertyOptional({ enum: ['PENDING_VERIFICATION'], nullable: true }) ingestionStatus?: string | null;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) archivedAt?: string | null;
  @ApiPropertyOptional({ type: [ProcessDefectEvidenceDto] }) evidence?: ProcessDefectEvidenceDto[];
  @ApiProperty({ type: [ProcessDefectMaterialDto] }) materials!: ProcessDefectMaterialDto[];
  @ApiProperty({ type: [ProcessDefectMaterialVerificationDto] }) materialVerificationHistory!: ProcessDefectMaterialVerificationDto[];
  @ApiProperty({ type: [ProcessDefectLedgerHistoryDto] }) ledgerHistory!: ProcessDefectLedgerHistoryDto[];
  @ApiProperty({ type: [ProcessDefectClassificationHistoryDto] }) classificationHistory!: ProcessDefectClassificationHistoryDto[];
  @ApiProperty({ type: ProcessDefectProjectResolutionDto, nullable: true }) componentProject!: ProcessDefectProjectResolutionDto | null;
  @ApiProperty() duplicateCount!: number;
  @ApiProperty({ type: [String] }) issues!: string[];
}

export class ProcessDefectPageDto {
  @ApiProperty({ type: [ProcessDefectDto] }) items!: ProcessDefectDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ProcessDefectClassificationResultDto {
  @ApiProperty({ type: [ProcessDefectDto] }) items!: ProcessDefectDto[];
}

export class ProcessIssueSourceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() defectId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class ProcessIssueWorkflowBindingDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() workflowDefinitionId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() workflowVersionId!: string;
  @ApiProperty({ minLength: 1, maxLength: 128 }) @IsString() @MaxLength(128) instanceKey!: string;
}

export class IssueProcessDefectsDto extends ProcessScopeDto {
  @ApiProperty({ type: [ProcessIssueSourceDto], minItems: 1, maxItems: 100 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ProcessIssueSourceDto) sources!: ProcessIssueSourceDto[];
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) problemType!: string;
  @ApiProperty({ enum: ['BRIEF', 'EIGHT_D'] }) @IsIn(['BRIEF', 'EIGHT_D']) responseForm!: 'BRIEF' | 'EIGHT_D';
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) responsibleScope!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) severity!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() dueAt?: Date;
  @ApiProperty({ type: ProcessIssueWorkflowBindingDto }) @ValidateNested() @Type(() => ProcessIssueWorkflowBindingDto) workflowBinding!: ProcessIssueWorkflowBindingDto;
}

export class ProcessIssueProblemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty({ format: 'uuid' }) workflowInstanceId!: string;
  @ApiProperty() version!: number;
}

export class ProcessIssueResultDto {
  @ApiProperty({ type: ProcessIssueProblemDto }) problem!: ProcessIssueProblemDto;
  @ApiProperty() replayed!: boolean;
}

export class ProcessProductionPeriodQueryDto extends ProcessScopeDto {
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() periodStart!: Date;
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() periodEnd!: Date;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) productCode?: string;
}

export class ProcessProductionQueryDto extends ProcessProductionPeriodQueryDto {
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) batchCode?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class CreateProcessProductionDto extends ProcessScopeDto {
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) batchCode!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) workOrderCode!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) operationCode!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) productCode!: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) lineCode?: string;
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() periodStart!: Date;
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() periodEnd!: Date;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) totalQuantity!: number;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) goodQuantity!: number;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) firstPassQuantity!: number;
}

export class CorrectProcessProductionDto extends ProcessScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @IsInt() @Min(1) totalQuantity?: number;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) goodQuantity!: number;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) firstPassQuantity!: number;
  @ApiProperty({ maxLength: 2000 }) @IsString() @MaxLength(2000) reason!: string;
}

export class ProcessProductionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() batchCode!: string;
  @ApiProperty() workOrderCode!: string;
  @ApiProperty() operationCode!: string;
  @ApiProperty() productCode!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) lineCode!: string | null;
  @ApiProperty({ format: 'date-time' }) periodStart!: Date;
  @ApiProperty({ format: 'date-time' }) periodEnd!: Date;
  @ApiProperty() totalQuantity!: number;
  @ApiProperty() goodQuantity!: number;
  @ApiProperty() firstPassQuantity!: number;
  @ApiProperty({ enum: ['MANUAL'] }) sourceKind!: string;
  @ApiProperty() yieldRate!: number;
  @ApiProperty() firstPassRate!: number;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}

export class ProcessProductionSummaryDto {
  @ApiProperty() batchCount!: number;
  @ApiProperty() totalQuantity!: number;
  @ApiProperty() goodQuantity!: number;
  @ApiProperty() firstPassQuantity!: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) yieldRate!: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) firstPassRate!: number | null;
}

export class ProcessProductionPageDto {
  @ApiProperty({ type: [ProcessProductionDto] }) items!: ProcessProductionDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ProcessProductionDetailDto extends ProcessProductionDto {
  @ApiProperty({ type: [Object] }) revisions!: Record<string, unknown>[];
  @ApiProperty({ type: [ProcessDefectDto] }) defects!: ProcessDefectDto[];
  @ApiProperty({ type: Number, nullable: true }) defectQuantity!: number | null;
}

export class CreateProcessShipmentReportDto extends ProcessScopeDto {
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) reportNumber?: string;
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() periodStart!: Date;
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() periodEnd!: Date;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) productCode?: string;
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 100 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('4', { each: true }) batchIds!: string[];
}

export class ProcessShipmentReportQueryDto extends ProcessScopeDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) productCode?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @Type(() => Boolean) @IsBoolean() includeArchived?: boolean;
}

export class ArchiveProcessShipmentReportDto extends ProcessScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class UpdateProcessShipmentReportEvidenceDto extends ProcessScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 20 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4', { each: true }) fileIds!: string[];
}

export class AssociateProcessShipmentReportCustomerDto extends ProcessScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() customerId!: string;
}

export class LinkProcessShipmentReportIssueDto extends ProcessScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() problemId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedProblemVersion!: number;
}

export class ProcessShipmentReportEvidenceDto {
  @ApiProperty({ format: 'uuid' }) fileId!: string;
  @ApiProperty() fileVersion!: number;
  @ApiProperty() sha256!: string;
  @ApiProperty({ format: 'date-time' }) scannedAt!: Date;
  @ApiProperty() position!: number;
}

export class ProcessShipmentReportCustomerDto {
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty() customerVersion!: number;
  @ApiProperty() customerCode!: string;
  @ApiProperty() customerName!: string;
}

export class ProcessShipmentReportIssueDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty() status!: string;
  @ApiProperty() version!: number;
}

export class ProcessShipmentReportDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty({ enum: ['DRAFT', 'ARCHIVED'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) periodStart!: Date;
  @ApiProperty({ format: 'date-time' }) periodEnd!: Date;
  @ApiPropertyOptional({ type: String, nullable: true }) productCode!: string | null;
  @ApiProperty() batchCount!: number;
  @ApiProperty() totalQuantity!: number;
  @ApiProperty() goodQuantity!: number;
  @ApiProperty() firstPassQuantity!: number;
  @ApiProperty() defectQuantity!: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) yieldRate!: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) firstPassRate!: number | null;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) archivedAt!: Date | null;
  @ApiProperty({ type: Object }) snapshot!: Record<string, unknown>;
  @ApiProperty({ type: [ProcessShipmentReportEvidenceDto] }) evidence!: ProcessShipmentReportEvidenceDto[];
  @ApiProperty({ type: [ProcessShipmentReportCustomerDto] }) customers!: ProcessShipmentReportCustomerDto[];
  @ApiProperty({ type: [ProcessShipmentReportIssueDto] }) issues!: ProcessShipmentReportIssueDto[];
}

export class ProcessShipmentReportPageDto {
  @ApiProperty({ type: [ProcessShipmentReportDto] }) items!: ProcessShipmentReportDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
