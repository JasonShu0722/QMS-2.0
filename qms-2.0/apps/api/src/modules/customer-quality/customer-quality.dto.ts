import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';

export class CustomerScopeDto { @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string; }
export class CreateCustomerDto extends CustomerScopeDto { @ApiProperty() @IsString() @MaxLength(100) code!: string; @ApiProperty() @IsString() @MaxLength(200) name!: string; }
export class UpdateCustomerDto extends CustomerScopeDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string; @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean; }
export class CreateComplaintDto extends CustomerScopeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() customerId!: string;
  @ApiProperty({ enum: ['ZERO_KM', 'AFTER_SALES'] }) @IsIn(['ZERO_KM', 'AFTER_SALES']) complaintType!: 'ZERO_KM' | 'AFTER_SALES';
  @ApiProperty() @IsString() @MaxLength(10000) defectDescription!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) terminalCustomerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) productCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) productModel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) vin?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) mileage?: number;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() purchaseDate?: Date;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() returnRequired?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() physicalAnalysisRequired?: boolean;
  @ApiProperty() @IsString() @MaxLength(32) severity!: string;
  @ApiProperty() @IsString() @MaxLength(100) severityPolicyVersion!: string;
  @ApiProperty({ type: Object }) severitySnapshot!: Prisma.InputJsonValue;
  @ApiPropertyOptional({ enum: ['ERP', 'SAP', 'IMS'] }) @IsOptional() @IsIn(['ERP', 'SAP', 'IMS']) externalSourceSystem?: 'ERP' | 'SAP' | 'IMS';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) externalRecordKey?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() sourceObservedAt?: Date;
}
export class UpdateComplaintDto extends CustomerScopeDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) defectDescription?: string; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) severity?: string; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) severityPolicyVersion?: string; @ApiPropertyOptional({ type: Object }) @IsOptional() severitySnapshot?: Prisma.InputJsonValue; }
export class ArchiveComplaintDto extends CustomerScopeDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; }
export class PhysicalDispositionDto extends CustomerScopeDto { @ApiProperty({ enum: ['RETURN', 'REPAIR', 'SCRAP', 'NO_RETURN', 'OTHER'] }) @IsIn(['RETURN', 'REPAIR', 'SCRAP', 'NO_RETURN', 'OTHER']) action!: string; @ApiProperty({ enum: ['PENDING', 'RECEIVED', 'REPAIRED', 'SCRAPPED', 'CLOSED'] }) @IsIn(['PENDING', 'RECEIVED', 'REPAIRED', 'SCRAPPED', 'CLOSED']) status!: string; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) responsibility?: string; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) notes?: string; }
export class PhysicalAnalysisDto extends CustomerScopeDto { @ApiProperty() @IsString() @MaxLength(10000) summary!: string; @ApiProperty({ enum: ['MISSING', 'IN_PROGRESS', 'COMPLETED'] }) @IsIn(['MISSING', 'IN_PROGRESS', 'COMPLETED']) status!: string; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) evidenceSummary?: string; }
