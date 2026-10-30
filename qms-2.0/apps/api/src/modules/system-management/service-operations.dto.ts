import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class ServiceOperationsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ enum: ['ORGANIZATION', 'PLATFORM'], default: 'ORGANIZATION' }) @IsOptional() @IsIn(['ORGANIZATION', 'PLATFORM']) scope?: 'ORGANIZATION' | 'PLATFORM';
}
export class ServiceOperationsCountsDto {
  @ApiPropertyOptional() waiting?: number;
  @ApiPropertyOptional() pending?: number;
  @ApiPropertyOptional() processing?: number;
  @ApiPropertyOptional() failed?: number;
  @ApiPropertyOptional() succeeded?: number;
  @ApiPropertyOptional() processed?: number;
  @ApiPropertyOptional() retried?: number;
}
export class ServiceOperationsResultDto {
  @ApiProperty({ enum: ['STARTED', 'SUCCEEDED', 'FAILED', 'STOPPED'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) observedAt!: string;
  @ApiPropertyOptional({ format: 'date-time' }) startedAt?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) completedAt?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) durationMs?: number | null;
  @ApiPropertyOptional({ enum: ['process-quality', 'customer-quality', 'new-product-quality', 'supplier-quality'] }) domainCode?: string;
  @ApiPropertyOptional({ enum: ['PDF_RENDER_FAILED', 'WORKER_EXECUTION_FAILED'] }) reasonCode?: string;
  @ApiPropertyOptional({ type: ServiceOperationsCountsDto }) counts?: ServiceOperationsCountsDto;
}
export class ServiceOperationsSourceDto {
  @ApiProperty({ enum: ['worker', 'outbox', 'files', 'mail', 'pdf'] }) key!: 'worker' | 'outbox' | 'files' | 'mail' | 'pdf';
  @ApiProperty({ enum: ['ORGANIZATION', 'PLATFORM'] }) coverage!: 'ORGANIZATION' | 'PLATFORM';
  @ApiProperty({ format: 'uuid', description: '授权来源及被查询的组织，不代表平台回执属于该组织。' }) organizationId!: string;
  @ApiProperty({ enum: ['UNKNOWN', 'STALE', 'UNAVAILABLE', 'RECENT_RESULT'], description: '仅最后事实或采集状态，不表示实时在线或系统整体健康。' }) status!: 'UNKNOWN' | 'STALE' | 'UNAVAILABLE' | 'RECENT_RESULT';
  @ApiProperty({ format: 'date-time' }) asOf!: string;
  @ApiPropertyOptional({ description: '配置可用不等于实际服务在线。' }) configured?: boolean;
  @ApiPropertyOptional() scannerConfigured?: boolean;
  @ApiPropertyOptional() storageConfigured?: boolean;
  @ApiPropertyOptional({ type: ServiceOperationsCountsDto }) counts?: ServiceOperationsCountsDto;
  @ApiPropertyOptional({ type: [ServiceOperationsResultDto], description: '固定上限的最近执行回执，不是日志或报文。PDF 为每请求线程，不是常驻队列。' }) results?: ServiceOperationsResultDto[];
  @ApiPropertyOptional({ enum: ['NO_RECEIPT', 'GLOBAL_SCOPE_REQUIRED', 'NOT_CONFIGURED', 'SOURCE_UNAVAILABLE', 'RECEIPT_EXPIRED'] }) reasonCode?: string;
}
export class ServiceOperationsPageDto {
  @ApiProperty({ enum: ['ORGANIZATION', 'PLATFORM'] }) scope!: 'ORGANIZATION' | 'PLATFORM';
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'date-time' }) asOf!: string;
  @ApiProperty({ type: [ServiceOperationsSourceDto] }) sources!: ServiceOperationsSourceDto[];
}
