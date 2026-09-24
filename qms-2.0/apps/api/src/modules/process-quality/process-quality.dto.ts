import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PROCESS_RESPONSIBILITY_CATEGORIES, type ProcessResponsibilityCategory } from './process-defect-ledger.service.js';

export class ProcessScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
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

export class CreateProcessDefectDto extends ProcessScopeDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @MaxLength(64) defectTypeCode!: string;
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) description!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) defectQuantity!: number;
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() occurredAt!: Date;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) batchCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) workOrderCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) operationCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) lineCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) projectCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) productCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) materialCode?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() supplierOrganizationId?: string;
  @ApiProperty({ enum: PROCESS_RESPONSIBILITY_CATEGORIES }) @IsIn(PROCESS_RESPONSIBILITY_CATEGORIES) responsibilityCategory!: ProcessResponsibilityCategory;
  @ApiPropertyOptional({ enum: ['MES', 'IMS'], description: '人工登记的外部来源标识；接口尚未启用' }) @IsOptional() @IsIn(['MES', 'IMS']) externalSourceSystem?: 'MES' | 'IMS';
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) externalRecordKey?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() sourceObservedAt?: Date;
}

export class UpdateProcessDefectDto extends ProcessScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiPropertyOptional({ maxLength: 64 }) @IsOptional() @IsString() @MaxLength(64) defectTypeCode?: string;
  @ApiPropertyOptional({ maxLength: 10000 }) @IsOptional() @IsString() @MaxLength(10000) description?: string;
  @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @IsInt() @Min(1) defectQuantity?: number;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() occurredAt?: Date;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) batchCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) workOrderCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) operationCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) lineCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) projectCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) productCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) materialCode?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() supplierOrganizationId?: string;
  @ApiPropertyOptional({ enum: PROCESS_RESPONSIBILITY_CATEGORIES }) @IsOptional() @IsIn(PROCESS_RESPONSIBILITY_CATEGORIES) responsibilityCategory?: ProcessResponsibilityCategory;
}

export class ArchiveProcessDefectDto extends ProcessScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
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
  @ApiPropertyOptional({ enum: PROCESS_RESPONSIBILITY_CATEGORIES }) @IsOptional() @IsIn(PROCESS_RESPONSIBILITY_CATEGORIES) responsibilityCategory?: ProcessResponsibilityCategory;
  @ApiPropertyOptional({ default: false }) @IsOptional() @Type(() => Boolean) @IsBoolean() includeArchived?: boolean;
}

export class ProcessDefectEvidenceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() originalName!: string;
  @ApiProperty() scanStatus!: string;
  @ApiProperty() status!: string;
}

export class ProcessDefectDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() defectTypeCode!: string;
  @ApiProperty() description!: string;
  @ApiProperty() defectQuantity!: number;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) batchCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) workOrderCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) operationCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) lineCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) projectCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) productCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) materialCode?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) supplierOrganizationId?: string | null;
  @ApiProperty({ enum: PROCESS_RESPONSIBILITY_CATEGORIES }) responsibilityCategory!: ProcessResponsibilityCategory;
  @ApiProperty({ enum: ['MANUAL'] }) sourceKind!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) externalSourceSystem?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) externalRecordKey?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) sourceObservedAt?: string | null;
  @ApiPropertyOptional({ enum: ['PENDING_VERIFICATION'], nullable: true }) ingestionStatus?: string | null;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) archivedAt?: string | null;
  @ApiPropertyOptional({ type: [ProcessDefectEvidenceDto] }) evidence?: ProcessDefectEvidenceDto[];
}

export class ProcessDefectPageDto {
  @ApiProperty({ type: [ProcessDefectDto] }) items!: ProcessDefectDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
