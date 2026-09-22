import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class OutboxScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  organizationId?: string;
}

export class OutboxFailureQueryDto extends OutboxScopeDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000)
  offset?: number;
}

export class OutboxFailureDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() eventType!: string;
  @ApiProperty() aggregateType!: string;
  @ApiProperty() aggregateId!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) availableAt!: string;
  @ApiProperty({ enum: ['OUTBOX_DELIVERY_FAILED'] }) reasonCode!: 'OUTBOX_DELIVERY_FAILED';
}

export class OutboxFailurePageDto {
  @ApiProperty({ type: [OutboxFailureDto] }) items!: OutboxFailureDto[];
  @ApiProperty() total!: number;
}

export class OutboxRetryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['PENDING'] }) status!: 'PENDING';
}
