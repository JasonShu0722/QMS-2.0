import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';
import type { SupplierDeadlineApproval, SupplierDeadlineDuty, SupplierDeadlineStage } from './supplier-eight-d-deadline.policy.js';

export class SupplierEightDDeadlineRequestDto {
  @ApiProperty({ enum: ['ANALYSIS', 'SUBMISSION', 'CLOSURE'] }) @IsIn(['ANALYSIS', 'SUBMISSION', 'CLOSURE']) stage!: SupplierDeadlineStage;
  @ApiProperty({ format: 'date-time' }) @IsDateString({ strict: true, strictSeparator: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) requestedDueAt!: string;
  @ApiProperty({ maxLength: 2000 }) @IsString() @Length(1, 2000) @Matches(/\S/) reason!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedRowVersion!: number;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedContentVersion!: number;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedInstanceVersion!: number;
}
export class SupplierEightDDeadlineCancelDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @ApiProperty({ maxLength: 2000 }) @IsString() @Length(1, 2000) @Matches(/\S/) comment!: string;
}
export class SupplierEightDDeadlineDecisionDto extends SupplierEightDDeadlineCancelDto {
  @ApiProperty({ enum: ['SQE', 'MANAGER'] }) @IsIn(['SQE', 'MANAGER']) duty!: SupplierDeadlineDuty;
  @ApiProperty({ enum: ['APPROVE', 'RETURN'] }) @IsIn(['APPROVE', 'RETURN']) decision!: 'APPROVE' | 'RETURN';
}

export class SupplierEightDDeadlineResultDto {
  @ApiPropertyOptional({ enum: ['approve-sqe', 'return-sqe', 'approve-manager', 'return-manager', 'cancel'], isArray: true }) allowedActions?: string[];
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) supplierProblemId!: string;
  @ApiProperty({ enum: ['ANALYSIS', 'SUBMISSION', 'CLOSURE'] }) stage!: SupplierDeadlineStage;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }) severity!: string;
  @ApiProperty({ enum: ['QUALITY_PENDING', 'MANAGER_PENDING', 'APPROVED', 'RETURNED', 'CANCELLED'] }) status!: SupplierDeadlineApproval;
  @ApiProperty({ format: 'date-time' }) originalDueAt!: string;
  @ApiProperty({ format: 'date-time' }) requestedDueAt!: string;
  @ApiProperty() originallyOverdue!: boolean;
  @ApiProperty() reason!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
