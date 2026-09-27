import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export const QUALITY_SOURCE_SYSTEMS = ['MANUAL', 'INTERNAL', 'IMS', 'MES', 'ERP', 'SAP'] as const;
export const QUALITY_EXTERNAL_SOURCE_SYSTEMS = ['IMS', 'MES', 'ERP', 'SAP'] as const;
export const QUALITY_DASHBOARD_DOMAINS = ['SUPPLIER', 'PROCESS', 'CUSTOMER', 'NEW_PRODUCT'] as const;
export const QUALITY_METRIC_DIRECTIONS = ['GTE', 'LTE'] as const;
export type QualityDashboardDomain = typeof QUALITY_DASHBOARD_DOMAINS[number];

export class QualityDataScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}

export class CreateMetricDefinitionDto extends QualityDataScopeDto {
  @ApiPropertyOptional({ enum: QUALITY_DASHBOARD_DOMAINS }) @IsOptional() @IsIn(QUALITY_DASHBOARD_DOMAINS) domain?: QualityDashboardDomain;
  @ApiProperty({ maxLength: 64 }) @IsString() @IsNotEmpty() @MaxLength(64) code!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiProperty({ maxLength: 32 }) @IsString() @IsNotEmpty() @MaxLength(32) unit!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @IsNotEmpty() @MaxLength(100) numeratorLabel!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @IsNotEmpty() @MaxLength(100) denominatorLabel!: string;
  @ApiProperty({ maxLength: 32 }) @IsString() @IsNotEmpty() @MaxLength(32) formulaVersion!: string;
  @ApiPropertyOptional({ maxLength: 64, description: '标准公式编码，如 INCOMING_ACCEPTANCE_RATE、PPM、PROCESS_DEFECT_RATE、FIRST_PASS_YIELD' }) @IsOptional() @IsString() @MaxLength(64) formulaCode?: string;
  @ApiPropertyOptional({ enum: QUALITY_METRIC_DIRECTIONS }) @IsOptional() @IsIn(QUALITY_METRIC_DIRECTIONS) thresholdDirection?: typeof QUALITY_METRIC_DIRECTIONS[number];
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsNumber() @Min(0) greenThreshold?: number;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsNumber() @Min(0) yellowThreshold?: number;
  @ApiPropertyOptional({ minimum: 1, default: 1 }) @IsOptional() @IsInt() @Min(1) abnormalPeriodLimit?: number;
}

export class MetricDefinitionDto extends CreateMetricDefinitionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty() version!: number;
  @ApiProperty() resolvedFormulaCode!: string;
  @ApiProperty({ enum: QUALITY_METRIC_DIRECTIONS }) resolvedThresholdDirection!: typeof QUALITY_METRIC_DIRECTIONS[number];
  @ApiProperty({ type: Number, nullable: true }) resolvedGreenThreshold!: number | null;
  @ApiProperty({ type: Number, nullable: true }) resolvedYellowThreshold!: number | null;
  @ApiProperty() resolvedAbnormalPeriodLimit!: number;
}

export class RecordMetricFactDto extends QualityDataScopeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() metricDefinitionId!: string;
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() periodStart!: Date;
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() periodEnd!: Date;
  @ApiProperty({ minimum: 0 }) @Type(() => Number) @IsInt() @Min(0) numerator!: number;
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) denominator!: number;
  @ApiPropertyOptional({ enum: QUALITY_SOURCE_SYSTEMS, default: 'MANUAL' }) @IsOptional() @IsIn(QUALITY_SOURCE_SYSTEMS) sourceSystem: typeof QUALITY_SOURCE_SYSTEMS[number] = 'MANUAL';
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) sourceRecordKey?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() sourceSnapshotId?: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() dimensions?: Record<string, unknown>;
}

export class MetricFactDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) metricDefinitionId!: string;
  @ApiProperty({ format: 'date-time' }) periodStart!: string;
  @ApiProperty({ format: 'date-time' }) periodEnd!: string;
  @ApiProperty() numerator!: number;
  @ApiProperty() denominator!: number;
  @ApiProperty() value!: number;
  @ApiProperty() sourceSystem!: string;
  @ApiPropertyOptional({ nullable: true }) sourceRecordKey?: string | null;
}

export class CreateQualitySnapshotDto extends QualityDataScopeDto {
  @ApiProperty({ enum: QUALITY_EXTERNAL_SOURCE_SYSTEMS }) @IsIn(QUALITY_EXTERNAL_SOURCE_SYSTEMS) sourceSystem!: typeof QUALITY_EXTERNAL_SOURCE_SYSTEMS[number];
  @ApiProperty({ maxLength: 200 }) @IsString() @IsNotEmpty() @MaxLength(200) externalRecordKey!: string;
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() observedAt!: Date;
  @ApiProperty({ type: Object }) @IsObject() payload!: Record<string, unknown>;
}

export class CreateInternalQualitySnapshotDto extends QualityDataScopeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() metricDefinitionId!: string;
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) expectedMetricVersion!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() problemIndexId!: string;
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) expectedProblemVersion!: number;
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() observedAt!: Date;
}

export class QualitySnapshotDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: QUALITY_SOURCE_SYSTEMS }) sourceSystem!: string;
  @ApiProperty() externalRecordKey!: string;
  @ApiProperty({ format: 'date-time' }) observedAt!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) problemIndexId?: string | null;
  @ApiPropertyOptional({ nullable: true }) problemVersion?: number | null;
}

export class QualityInternalSourceDto {
  @ApiProperty({ enum: ['PROBLEM_INDEX'] }) type!: 'PROBLEM_INDEX';
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: number;
  @ApiProperty() domainCode!: string;
  @ApiProperty() domainSourceType!: string;
  @ApiProperty({ format: 'uuid' }) domainSourceId!: string;
}

export class QualityFactDrilldownDto {
  @ApiProperty({ type: MetricFactDto }) fact!: MetricFactDto;
  @ApiProperty({ type: QualitySnapshotDto, nullable: true }) snapshot!: QualitySnapshotDto | null;
  @ApiProperty({ type: QualityInternalSourceDto, nullable: true }) source!: QualityInternalSourceDto | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
}

export class QualitySnapshotDetailDto extends QualitySnapshotDto {
  @ApiProperty({ type: Object }) payload!: Record<string, unknown>;
}

export class QualityFactDrilldownQueryDto extends QualityDataScopeDto {
  @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) expectedMetricVersion?: number;
}

export class MetricTrendQueryDto extends QualityDataScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() metricDefinitionId?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 500 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit = 100;
}

export class QualityDashboardQueryDto extends MetricTrendQueryDto {
  @ApiPropertyOptional({ enum: QUALITY_DASHBOARD_DOMAINS }) @IsOptional() @IsIn(QUALITY_DASHBOARD_DOMAINS) domain?: QualityDashboardDomain;
}

export class QualityManagementReportQueryDto extends QualityDashboardQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5000, default: 500 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit = 500;
}

export class QualityInsightDto {
  @ApiProperty({ format: 'uuid' }) metricDefinitionId!: string;
  @ApiProperty() metricCode!: string;
  @ApiProperty() metricName!: string;
  @ApiProperty({ enum: ['STABLE', 'RISING', 'FALLING', 'INSUFFICIENT_DATA'] }) signal!: 'STABLE' | 'RISING' | 'FALLING' | 'INSUFFICIENT_DATA';
  @ApiProperty() summary!: string;
  @ApiProperty({ type: [String] }) evidence!: string[];
  @ApiProperty({ enum: ['RULE_BASED'] }) generatedBy!: 'RULE_BASED';
}

export class MetricTrendPointDto extends MetricFactDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
}

export class QualityDashboardDomainSummaryDto {
  @ApiProperty({ enum: [...QUALITY_DASHBOARD_DOMAINS, 'UNSPECIFIED'] }) domain!: QualityDashboardDomain | 'UNSPECIFIED';
  @ApiProperty() label!: string;
  @ApiProperty() factCount!: number;
  @ApiProperty() metricCount!: number;
}

export class QualityDashboardCardDto {
  @ApiProperty({ enum: [...QUALITY_DASHBOARD_DOMAINS, 'UNSPECIFIED'] }) domain!: QualityDashboardDomain | 'UNSPECIFIED';
  @ApiProperty() metricCode!: string;
  @ApiProperty() metricName!: string;
  @ApiProperty() unit!: string;
  @ApiProperty({ enum: ['AVAILABLE', 'MANUAL', 'PENDING_REVIEW', 'NO_DATA'] }) status!: 'AVAILABLE' | 'MANUAL' | 'PENDING_REVIEW' | 'NO_DATA';
  @ApiProperty({ type: Number, nullable: true }) latestValue!: number | null;
  @ApiProperty({ type: Number, nullable: true }) numerator!: number | null;
  @ApiProperty({ type: Number, nullable: true }) denominator!: number | null;
  @ApiProperty({ nullable: true }) sourceSystem!: string | null;
  @ApiProperty({ nullable: true }) sourceRecordKey!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true }) periodStart!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true }) periodEnd!: string | null;
  @ApiProperty({ enum: ['GREEN', 'YELLOW', 'RED', 'NO_DATA'] }) signal!: 'GREEN' | 'YELLOW' | 'RED' | 'NO_DATA';
  @ApiProperty() abnormalPeriods!: number;
  @ApiProperty() consecutiveRedPeriods!: number;
  @ApiProperty() alert!: boolean;
}

export class QualityDashboardDto {
  @ApiProperty({ type: [MetricDefinitionDto] }) metrics!: MetricDefinitionDto[];
  @ApiProperty({ type: [MetricFactDto] }) latestFacts!: MetricFactDto[];
  @ApiProperty() generatedAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) from!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) to!: string | null;
  @ApiProperty({ type: [QualityDashboardDomainSummaryDto] }) domains!: QualityDashboardDomainSummaryDto[];
  @ApiProperty({ type: [QualityDashboardCardDto] }) cards!: QualityDashboardCardDto[];
}
