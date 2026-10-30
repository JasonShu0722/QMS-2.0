import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export const EXCHANGE_STAGES = ['transfer', 'validation', 'processing', 'reconciliation'] as const;
export const EXCHANGE_OUTCOMES = ['NOT_REPORTED', 'PENDING', 'UNKNOWN', 'SUCCEEDED', 'FAILED'] as const;
export const EXCHANGE_ERRORS = ['TRANSFER_FAILED', 'VALIDATION_REJECTED', 'PROCESSING_FAILED', 'RECONCILIATION_FAILED', 'UNKNOWN_FAILURE'] as const;
export type ExchangeStage = (typeof EXCHANGE_STAGES)[number];
export type ExchangeOutcome = (typeof EXCHANGE_OUTCOMES)[number];

export class DataExchangeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ enum: ['ORGANIZATION', 'PLATFORM'], default: 'ORGANIZATION' }) @IsOptional() @IsIn(['ORGANIZATION', 'PLATFORM']) scope?: 'ORGANIZATION' | 'PLATFORM';
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 10000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number;
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ maxLength: 64 }) @IsOptional() @IsString() @MaxLength(64) @Matches(/^[A-Z][A-Z0-9_]*$/) sourceKey?: string;
  @ApiPropertyOptional({ enum: ['INBOUND', 'OUTBOUND'] }) @IsOptional() @IsIn(['INBOUND', 'OUTBOUND']) direction?: 'INBOUND' | 'OUTBOUND';
  @ApiPropertyOptional({ maxLength: 48 }) @IsOptional() @IsString() @MaxLength(48) @Matches(/^[A-Z][A-Z0-9_]*$/) objectType?: string;
  @ApiPropertyOptional({ enum: ['BATCH', 'RECORD'] }) @IsOptional() @IsIn(['BATCH', 'RECORD']) level?: 'BATCH' | 'RECORD';
  @ApiPropertyOptional({ maxLength: 80 }) @IsOptional() @IsString() @MaxLength(80) @Matches(/^[A-Za-z0-9_.:-]+$/) batchId?: string;
  @ApiPropertyOptional({ enum: EXCHANGE_STAGES }) @IsOptional() @IsIn(EXCHANGE_STAGES) stage?: ExchangeStage;
  @ApiPropertyOptional({ enum: EXCHANGE_OUTCOMES }) @IsOptional() @IsIn(EXCHANGE_OUTCOMES) outcome?: ExchangeOutcome;
}
export class DataExchangeSourceDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ type: [String], enum: ['INBOUND', 'OUTBOUND'] }) directions!: string[];
  @ApiProperty({ type: [String] }) objectTypes!: string[];
}
export class DataExchangeStageDto {
  @ApiProperty({ enum: EXCHANGE_OUTCOMES }) outcome!: ExchangeOutcome;
  @ApiPropertyOptional({ minimum: 0, maximum: 1000000000 }) observedCount?: number;
  @ApiPropertyOptional({ enum: EXCHANGE_ERRORS }) errorCode?: (typeof EXCHANGE_ERRORS)[number];
  @ApiPropertyOptional({ format: 'date-time' }) observedAt?: string;
}
export class DataExchangeStagesDto {
  @ApiProperty({ type: DataExchangeStageDto }) transfer!: DataExchangeStageDto;
  @ApiProperty({ type: DataExchangeStageDto }) validation!: DataExchangeStageDto;
  @ApiProperty({ type: DataExchangeStageDto }) processing!: DataExchangeStageDto;
  @ApiProperty({ type: DataExchangeStageDto }) reconciliation!: DataExchangeStageDto;
}
export class DataExchangeAttemptDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() sourceKey!: string;
  @ApiProperty({ enum: ['INBOUND', 'OUTBOUND'] }) direction!: string;
  @ApiProperty() objectType!: string;
  @ApiProperty({ enum: ['BATCH', 'RECORD'] }) level!: string;
  @ApiProperty() correlationId!: string;
  @ApiPropertyOptional() batchId?: string;
  @ApiPropertyOptional() recordId?: string;
  @ApiProperty({ minimum: 1 }) attemptNumber!: number;
  @ApiProperty({ type: DataExchangeStagesDto }) stages!: DataExchangeStagesDto;
  @ApiProperty({ format: 'date-time' }) startedAt!: string;
  @ApiProperty({ format: 'date-time' }) observedAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true, description: '仅全部四阶段都有终态时存在，传输成功不代表整个尝试完成。' }) finishedAt!: string | null;
}
export class DataExchangeSummaryDto {
  @ApiProperty() batchAttempts!: number;
  @ApiProperty() recordAttempts!: number;
  @ApiProperty({ description: '仅批次尝试，不与记录层级相加。' }) transferSucceededBatches!: number;
  @ApiProperty() processingFailedBatches!: number;
  @ApiProperty() reconciliationSucceededBatches!: number;
}
export class DataExchangeCollectionDto {
  @ApiProperty({ enum: ['UNKNOWN', 'UNAVAILABLE'], description: '观测状态不等于外部连接或业务健康；进程丢失前未持久窗口保持未知。' }) status!: 'UNKNOWN' | 'UNAVAILABLE';
}
export class DataExchangePageDto {
  @ApiProperty({ enum: ['ORGANIZATION', 'PLATFORM'] }) scope!: 'ORGANIZATION' | 'PLATFORM';
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ enum: ['NOT_CONNECTED', 'REGISTERED'], description: '仅内部来源注册状态，不证明真实业务联调或在线。' }) connectionStatus!: 'NOT_CONNECTED' | 'REGISTERED';
  @ApiProperty({ type: [DataExchangeSourceDto] }) sources!: DataExchangeSourceDto[];
  @ApiProperty({ type: [DataExchangeAttemptDto] }) items!: DataExchangeAttemptDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty({ format: 'date-time' }) from!: string;
  @ApiProperty({ format: 'date-time' }) to!: string;
  @ApiProperty({ format: 'date-time' }) asOf!: string;
  @ApiProperty({ type: DataExchangeSummaryDto }) summary!: DataExchangeSummaryDto;
  @ApiProperty({ type: DataExchangeCollectionDto }) collection!: DataExchangeCollectionDto;
}
