import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
export const TARGET_PERIOD_TYPES = ['ANNUAL', 'MONTHLY'] as const;
export const TARGET_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PUBLISHED', 'RETIRED'] as const;
export class SupplierQualityTargetQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() profileId?: string;
  @ApiPropertyOptional({ minimum: 2000, maximum: 2200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2200) year?: number;
  @ApiPropertyOptional({ enum: TARGET_PERIOD_TYPES }) @IsOptional() @IsIn(TARGET_PERIOD_TYPES) periodType?: typeof TARGET_PERIOD_TYPES[number];
  @ApiPropertyOptional({ enum: TARGET_STATUSES }) @IsOptional() @IsIn(TARGET_STATUSES) status?: typeof TARGET_STATUSES[number];
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
export class CreateSupplierQualityTargetDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() profileId!: string;
  @ApiProperty({ enum: TARGET_PERIOD_TYPES }) @IsIn(TARGET_PERIOD_TYPES) periodType!: typeof TARGET_PERIOD_TYPES[number];
  @ApiProperty({ minimum: 2000, maximum: 2200 }) @IsInt() @Min(2000) @Max(2200) targetYear!: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 12 }) @IsOptional() @IsInt() @Min(1) @Max(12) targetMonth?: number;
  @ApiProperty({ maxLength: 300 }) @IsString() @MaxLength(300) title!: string;
  @ApiProperty({ type: Object }) @IsObject() metrics!: Record<string, unknown>;
}
export class SupplierQualityTargetTransitionDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; }
export class ApproveSupplierQualityTargetDto extends SupplierQualityTargetTransitionDto {
  @ApiPropertyOptional({ format: 'uuid', description: '已完成的电子签章记录 ID' }) @IsOptional() @IsUUID() approvalSignatureId?: string;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class PublishSupplierQualityTargetDto extends SupplierQualityTargetTransitionDto {
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString() effectiveFrom?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString() effectiveTo?: string;
}
export class ReviseSupplierQualityTargetDto extends CreateSupplierQualityTargetDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; }
export class SupplierQualityTargetDto {
  @ApiProperty({ format: 'uuid' }) id!: string; @ApiProperty({ format: 'uuid' }) ownerOrganizationId!: string; @ApiProperty({ format: 'uuid' }) supplierOrganizationId!: string; @ApiProperty({ format: 'uuid' }) profileId!: string;
  @ApiProperty({ enum: TARGET_PERIOD_TYPES }) periodType!: string; @ApiProperty() targetYear!: number; @ApiPropertyOptional({ nullable: true }) targetMonth!: number | null; @ApiProperty() revision!: number; @ApiProperty() title!: string; @ApiProperty({ type: Object }) metrics!: Record<string, unknown>; @ApiProperty({ enum: TARGET_STATUSES }) status!: string; @ApiProperty() version!: number;
  @ApiPropertyOptional({ format: 'date', nullable: true }) effectiveFrom!: string | null; @ApiPropertyOptional({ format: 'date', nullable: true }) effectiveTo!: string | null; @ApiPropertyOptional({ format: 'uuid', nullable: true }) approvalSignatureId!: string | null; @ApiProperty({ format: 'date-time' }) createdAt!: string; @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class SupplierQualityTargetPageDto { @ApiProperty({ type: [SupplierQualityTargetDto] }) items!: SupplierQualityTargetDto[]; @ApiProperty() total!: number; @ApiProperty() page!: number; @ApiProperty() pageSize!: number; }

export class RecordSupplierQualityTargetActualDto {
  @ApiProperty({ minimum: 0, description: '当前实际值版本；首次写入为 0' }) @IsInt() @Min(0) expectedVersion!: number;
  @ApiProperty({ type: Object, description: '指标名与实际数值；指标必须已在目标版本中定义为数值' }) @IsObject() metrics!: Record<string, unknown>;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class SupplierQualityTargetActualQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
export class SupplierQualityTargetActualDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) targetId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() targetVersion!: number;
  @ApiProperty({ type: Object }) metrics!: Record<string, number>;
  @ApiProperty({ type: Object }) targetMetrics!: Record<string, number>;
  @ApiProperty({ type: Object, description: '实际值减目标值；正负本身不表示达标' }) deviations!: Record<string, number>;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty({ format: 'uuid' }) createdById!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class SupplierQualityTargetActualHistoryDto {
  @ApiProperty({ format: 'uuid' }) targetId!: string;
  @ApiProperty() latestVersion!: number;
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty({ type: [SupplierQualityTargetActualDto] }) items!: SupplierQualityTargetActualDto[];
}
