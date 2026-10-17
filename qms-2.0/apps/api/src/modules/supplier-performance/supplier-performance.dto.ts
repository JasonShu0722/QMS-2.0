import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class SupplierPerformanceQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() profileId?: string;
  @ApiPropertyOptional({ example: '2026-09' }) @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class CreateSupplierPerformanceCardDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() profileId!: string;
  @ApiProperty({ example: '2026-09' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month!: string;
  @ApiProperty({ minimum: 0, maximum: 100 }) @IsInt() @Min(0) @Max(100) cooperationScore!: number;
  @ApiProperty({ maxLength: 2000 }) @IsString() @MaxLength(2000) cooperationNote!: string;
  @ApiProperty({ minimum: 0, maximum: 100 }) @IsInt() @Min(0) @Max(100) incomingWeight!: number;
  @ApiProperty({ minimum: 0, maximum: 100 }) @IsInt() @Min(0) @Max(100) cooperationWeight!: number;
}

export class PublishSupplierPerformanceCardDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class SupplierPerformanceSourceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ enum: ['PASS', 'NG'] }) conclusion!: string;
}

export class SupplierPerformanceCardDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) profileId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) supplierOrganizationId!: string | null;
  @ApiProperty() supplierName!: string;
  @ApiProperty({ example: '2026-09' }) month!: string;
  @ApiProperty() inspectionCount!: number;
  @ApiProperty() passCount!: number;
  @ApiProperty() incomingScore!: number;
  @ApiProperty() cooperationScore!: number;
  @ApiProperty() incomingWeight!: number;
  @ApiProperty() cooperationWeight!: number;
  @ApiProperty() cooperationNote!: string;
  @ApiProperty() totalScore!: number;
  @ApiProperty({ type: [SupplierPerformanceSourceDto] }) sourceInspections!: SupplierPerformanceSourceDto[];
  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED'] }) status!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) publishedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class SupplierPerformancePageDto {
  @ApiProperty({ type: [SupplierPerformanceCardDto] }) items!: SupplierPerformanceCardDto[];
  @ApiProperty() total!: number;
}

export class CreateSupplierPerformanceAppealDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() cardId!: string;
  @ApiProperty({ maxLength: 4000 }) @IsString() @MaxLength(4000) reason!: string;
}
export class SupplierPerformanceAppealTransitionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiPropertyOptional({ enum: ['ACCEPTED', 'REJECTED'] }) @IsOptional() @IsIn(['ACCEPTED', 'REJECTED']) decision?: 'ACCEPTED' | 'REJECTED';
  @ApiPropertyOptional({ maxLength: 4000 }) @IsOptional() @IsString() @MaxLength(4000) note?: string;
}
export class SupplierPerformanceAppealDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) cardId!: string;
  @ApiProperty({ format: 'uuid' }) supplierOrganizationId!: string;
  @ApiProperty({ enum: ['DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED'] }) status!: string;
  @ApiProperty() reason!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) decisionNote!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class SupplierPerformanceAppealPageDto {
  @ApiProperty({ type: [SupplierPerformanceAppealDto] }) items!: SupplierPerformanceAppealDto[];
  @ApiProperty() total!: number;
}
