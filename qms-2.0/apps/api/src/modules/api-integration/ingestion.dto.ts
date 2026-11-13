import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { IntegrationPageQueryDto, IntegrationScopeDto } from './integration-admin.dto.js';
import type { IngestionTarget } from './ingestion.policy.js';

export class IngestionConditionDto {
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) path!: string;
  @ApiProperty({ enum: ['EQ', 'NE', 'IN', 'NOT_IN', 'EMPTY', 'NOT_EMPTY'] }) @IsIn(['EQ', 'NE', 'IN', 'NOT_IN', 'EMPTY', 'NOT_EMPTY']) operator!: 'EQ' | 'NE' | 'IN' | 'NOT_IN' | 'EMPTY' | 'NOT_EMPTY';
  @ApiPropertyOptional({ oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] } }], nullable: true }) @IsOptional() value?: string | number | boolean | null | (string | number | boolean)[];
}
export class SaveIngestionRuleDto extends IntegrationScopeDto {
  @ApiProperty({ maxLength: 120 }) @IsString() @MaxLength(120) name!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() endpointId!: string;
  @ApiProperty({ enum: ['SUPPLIER', 'CUSTOMER', 'MATERIAL', 'COMPONENT'] }) @IsIn(['SUPPLIER', 'CUSTOMER', 'MATERIAL', 'COMPONENT']) target!: IngestionTarget;
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty({ enum: ['ALL', 'ANY'] }) @IsIn(['ALL', 'ANY']) match!: 'ALL' | 'ANY';
  @ApiProperty({ type: [IngestionConditionDto], maxItems: 20 }) @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => IngestionConditionDto) conditions!: IngestionConditionDto[];
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: 'code/name及供应商contactName/contactEmail对应的受限点路径。' }) @IsObject() mapping!: Record<string, string>;
  @ApiProperty({ enum: ['INSERT_ONLY', 'UPDATE', 'CONFIRM'] }) @IsIn(['INSERT_ONLY', 'UPDATE', 'CONFIRM']) mode!: 'INSERT_ONLY' | 'UPDATE' | 'CONFIRM';
  @ApiProperty({ type: [String], maxItems: 3 }) @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) updateFields!: string[];
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) sourceUpdatedAtField?: string;
}
export class UpdateIngestionRuleDto extends SaveIngestionRuleDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}
export class IngestionRuleDto extends SaveIngestionRuleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) creatorId!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class IngestionRulePageDto {
  @ApiProperty({ type: [IngestionRuleDto] }) items!: IngestionRuleDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class IngestionEndpointDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty() status!: string;
}
export class IngestionEndpointPageDto {
  @ApiProperty({ type: [IngestionEndpointDto] }) items!: IngestionEndpointDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class DeleteIngestionRuleDto extends IntegrationScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}
export class IngestionPreviewInputDto extends IntegrationScopeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() ruleId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) ruleVersion!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() receiptId!: string;
  @ApiProperty({ minimum: 0, maximum: 9999 }) @IsInt() @Min(0) @Max(9999) rowIndex!: number;
}
export class IngestionHistoryPreviewInputDto extends IntegrationScopeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() ruleId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) ruleVersion!: number;
  @ApiProperty({ format: 'date-time' }) @IsISO8601({ strict: true }) from!: string;
  @ApiProperty({ format: 'date-time' }) @IsISO8601({ strict: true }) to!: string;
}
export class IngestionDifferenceDto {
  @ApiProperty() field!: string;
  @ApiProperty({ nullable: true, type: String }) before!: string | null;
  @ApiProperty({ nullable: true, type: String }) after!: string | null;
}
export class IngestionPreviewDto {
  @ApiProperty({ format: 'uuid' }) previewId!: string;
  @ApiProperty() receiptCount!: number;
  @ApiProperty() rowCount!: number;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiPropertyOptional({ enum: ['INSERTED', 'UPDATED', 'UNCHANGED', 'FILTERED', 'EXISTING_SKIPPED', 'AWAITING_CONFIRMATION', 'VALIDATION_FAILED'] }) action?: string;
  @ApiPropertyOptional() errorCode?: string;
  @ApiPropertyOptional({ maxLength: 200, description: '受控来源路径或target字段标识，不含业务值。' }) errorField?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } }) fields?: Record<string, string>;
  @ApiPropertyOptional({ type: [IngestionDifferenceDto] }) differences?: IngestionDifferenceDto[];
}
export class SubmitIngestionImportDto extends IntegrationScopeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() previewId!: string;
  @ApiProperty() @IsBoolean() confirmed!: boolean;
  @ApiPropertyOptional({ maxLength: 300, description: '显式重新处理时填写；保留新处理记录。' }) @IsOptional() @IsString() @MaxLength(300) reprocessReason?: string;
}
export class IngestionImportResultDto {
  @ApiProperty({ type: [String] }) jobIds!: string[];
  @ApiProperty() reused!: boolean;
  @ApiProperty() receiptCount!: number;
  @ApiProperty() rowCount!: number;
}
export class IngestionJobQueryDto extends IntegrationPageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() endpointId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() receiptId?: string;
}
export class IngestionJobDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) endpointId!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) receiptId!: string | null;
  @ApiProperty({ format: 'uuid' }) ruleId!: string;
  @ApiProperty() ruleVersion!: number;
  @ApiProperty({ enum: ['SUPPLIER', 'CUSTOMER', 'MATERIAL', 'COMPONENT'] }) target!: IngestionTarget;
  @ApiProperty({ enum: ['AUTO', 'SINGLE', 'HISTORY'] }) source!: string;
  @ApiProperty({ enum: ['PENDING', 'PAUSED', 'BLOCKED', 'COMPLETED', 'CANCELLED'] }) status!: string;
  @ApiProperty() sequence!: number;
  @ApiProperty() total!: number;
  @ApiProperty() pending!: number;
  @ApiProperty() succeeded!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty() failed!: number;
  @ApiProperty() awaitingConfirmation!: number;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class IngestionJobPageDto {
  @ApiProperty({ type: [IngestionJobDto] }) items!: IngestionJobDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class IngestionItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) jobId!: string;
  @ApiProperty({ format: 'uuid' }) receiptId!: string;
  @ApiProperty() rowIndex!: number;
  @ApiProperty({ enum: ['PENDING', 'INSERTED', 'UPDATED', 'UNCHANGED', 'FILTERED', 'EXISTING_SKIPPED', 'AWAITING_CONFIRMATION', 'VALIDATION_FAILED', 'PROCESSING_FAILED', 'SKIPPED', 'CANCELLED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ nullable: true, type: String, maxLength: 200 }) errorField!: string | null;
  @ApiProperty({ nullable: true, format: 'uuid', type: String }) duplicateOfItemId!: string | null;
  @ApiProperty({ nullable: true, format: 'uuid', type: String }) targetId!: string | null;
  @ApiProperty({ nullable: true, type: Number }) targetVersion!: number | null;
  @ApiProperty() version!: number;
}
export class IngestionItemPageDto {
  @ApiProperty({ type: [IngestionItemDto] }) items!: IngestionItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class IngestionControlDto extends IntegrationScopeDto {
  @ApiProperty({ enum: ['PAUSE', 'RESUME', 'CANCEL', 'RETRY'] }) @IsIn(['PAUSE', 'RESUME', 'CANCEL', 'RETRY']) action!: 'PAUSE' | 'RESUME' | 'CANCEL' | 'RETRY';
  @ApiProperty({ maxLength: 300 }) @IsString() @MaxLength(300) reason!: string;
}
export class IngestionItemActionDto extends IntegrationScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ maxLength: 300 }) @IsString() @MaxLength(300) reason!: string;
}
export class IngestionItemDetailDto extends IngestionItemDto {
  @ApiProperty({ type: [IngestionDifferenceDto] }) differences!: IngestionDifferenceDto[];
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } }) fields?: Record<string, string>;
  @ApiProperty() stale!: boolean;
}
