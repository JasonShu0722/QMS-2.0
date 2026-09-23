import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min, Max } from 'class-validator';

export class SupplierPortalNotificationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000)
  offset?: number;
}

export class SupplierPortalNotificationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty({ format: 'uuid' }) taskId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty() nodeName!: string;
  @ApiProperty({ enum: ['TASK_ASSIGNED', 'TASK_REMINDER'] }) kind!: string;
  @ApiProperty({ type: String, nullable: true }) subject!: string | null;
  @ApiProperty() body!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) readAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class SupplierPortalNotificationPageDto {
  @ApiProperty({ type: [SupplierPortalNotificationDto] }) items!: SupplierPortalNotificationDto[];
  @ApiProperty() total!: number;
}
