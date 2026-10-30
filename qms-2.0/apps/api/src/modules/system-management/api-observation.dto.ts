import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export const API_OBSERVATION_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'OTHER'] as const;
export class ApiObservationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ enum: ['ORGANIZATION', 'PLATFORM'], default: 'ORGANIZATION' }) @IsOptional() @IsIn(['ORGANIZATION', 'PLATFORM']) scope?: 'ORGANIZATION' | 'PLATFORM';
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 10000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number;
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ enum: API_OBSERVATION_METHODS }) @IsOptional() @IsIn(API_OBSERVATION_METHODS) method?: (typeof API_OBSERVATION_METHODS)[number];
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) statusClass?: number;
  @ApiPropertyOptional({ description: '精确注册路由模板或 UNKNOWN，不接收原请求 URL。', maxLength: 200 })
  @IsOptional() @IsString() @MaxLength(200) @Matches(/^(?:UNKNOWN|\/api\/v1(?:\/[A-Za-z0-9_:.*-]+)*)$/) route?: string;
}
export class ApiObservationBucketDto {
  @ApiProperty({ format: 'date-time' }) minute!: string;
  @ApiProperty({ description: '可信组织 UUID，或平台未归属桶 UNSCOPED。' }) scopeKey!: string;
  @ApiProperty({ enum: API_OBSERVATION_METHODS }) method!: string;
  @ApiProperty() route!: string;
  @ApiProperty() statusClass!: number;
  @ApiProperty() count!: number;
  @ApiProperty() durationTotal!: number;
  @ApiProperty() durationMax!: number;
  @ApiProperty() le50!: number;
  @ApiProperty() le200!: number;
  @ApiProperty() le1000!: number;
  @ApiProperty() le5000!: number;
  @ApiProperty() gt5000!: number;
}
export class ApiObservationSummaryDto {
  @ApiProperty() requests!: number;
  @ApiProperty() errors!: number;
  @ApiProperty({ description: '各请求耗时之和，毫秒。' }) durationTotal!: number;
  @ApiProperty() durationMax!: number;
  @ApiProperty() le50!: number;
  @ApiProperty() le200!: number;
  @ApiProperty() le1000!: number;
  @ApiProperty() le5000!: number;
  @ApiProperty() gt5000!: number;
}
export class ApiObservationProducerDto {
  @ApiProperty({ format: 'uuid' }) producerId!: string;
  @ApiProperty({ format: 'date-time' }) startedAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) lastFlushedAt!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) lastFailureAt!: string | null;
  @ApiProperty() dropped!: number;
  @ApiProperty() failures!: number;
}
export class ApiObservationCollectorDto {
  @ApiProperty({ enum: ['UNKNOWN', 'CURRENT', 'PARTIAL', 'STALE'], description: '仅表示采集回执，不代表业务或全系统健康。组织视图保守返回 UNKNOWN。' }) status!: 'UNKNOWN' | 'CURRENT' | 'PARTIAL' | 'STALE';
  @ApiPropertyOptional({ type: [ApiObservationProducerDto], description: '仅真实平台权限且显式 PLATFORM 时返回。' }) producers?: ApiObservationProducerDto[];
  @ApiPropertyOptional({ description: '仅平台返回当前进程尚未持久化的累计丢弃数。' }) liveDropped?: number;
  @ApiPropertyOptional() liveFailures?: number;
}
export class ApiObservationPageDto {
  @ApiProperty({ enum: ['ORGANIZATION', 'PLATFORM'] }) scope!: 'ORGANIZATION' | 'PLATFORM';
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'date-time' }) from!: string;
  @ApiProperty({ format: 'date-time' }) to!: string;
  @ApiProperty({ format: 'date-time' }) asOf!: string;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty({ type: [ApiObservationBucketDto] }) items!: ApiObservationBucketDto[];
  @ApiProperty({ type: ApiObservationSummaryDto }) summary!: ApiObservationSummaryDto;
  @ApiProperty({ type: ApiObservationCollectorDto }) collector!: ApiObservationCollectorDto;
}
