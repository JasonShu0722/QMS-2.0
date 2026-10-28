import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import type { SupplierEightDNotificationKind, SupplierEightDTaskDuty, SupplierEightDTaskStage } from './supplier-eight-d-task.types.js';

export class SupplierEightDTaskQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_, value) => value !== undefined) @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_, value) => value !== undefined) @IsUUID() supplierProblemId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Last examined supplier problem ID, not a task ID.' })
  @ValidateIf((_, value) => value !== undefined) @IsUUID() cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25, description: 'Maximum problems examined; each problem may have multiple real duties.' })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value)
  @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class SupplierEightDTaskDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: 'uuid' }) supplierProblemId!: string;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty({ format: 'uuid' }) workflowVersionId!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ enum: ['HANDLING', 'CLOSURE', 'EXTENSION'] }) kind!: 'HANDLING' | 'CLOSURE' | 'EXTENSION';
  @ApiProperty({ enum: ['ANALYSIS', 'SUBMISSION', 'CLOSURE'] }) stage!: SupplierEightDTaskStage;
  @ApiProperty({ enum: ['HANDLING', 'PENDING', 'QUALITY_PENDING', 'MANAGER_PENDING'] }) status!: 'HANDLING' | 'PENDING' | 'QUALITY_PENDING' | 'MANAGER_PENDING';
  @ApiProperty({ type: String, enum: ['PROFESSIONAL', 'SECTION_MANAGER', 'MINISTER', 'SQE', 'MANAGER'], nullable: true }) duty!: SupplierEightDTaskDuty | null;
  @ApiProperty() rowVersion!: number;
  @ApiProperty() contentVersion!: number;
  @ApiProperty() instanceVersion!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) dueAt!: string | null;
  @ApiProperty() overdue!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) roundId!: string | null;
  @ApiProperty({ type: Number, nullable: true }) roundVersion!: number | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) requestId!: string | null;
  @ApiProperty({ type: Number, nullable: true }) requestVersion!: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) requestedDueAt!: string | null;
  @ApiProperty({ enum: ['OPEN_REPORT', 'ANALYSIS_COMPLETE', 'SUBMIT', 'DECIDE_CLOSURE', 'DECIDE_EXTENSION'], isArray: true })
  actions!: Array<'OPEN_REPORT' | 'ANALYSIS_COMPLETE' | 'SUBMIT' | 'DECIDE_CLOSURE' | 'DECIDE_EXTENSION'>;
}

export class SupplierEightDNotificationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) supplierProblemId!: string;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty({ enum: ['HANDLING_REMINDER', 'CLOSURE_REMINDER', 'EXTENSION_PENDING'] }) kind!: SupplierEightDNotificationKind;
  @ApiProperty() subject!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ enum: ['IN_APP'] }) channel!: 'IN_APP';
  @ApiProperty({ enum: ['DELIVERED'] }) status!: 'DELIVERED';
  @ApiProperty({ format: 'date-time' }) deliveredAt!: string;
}

export class SupplierEightDTaskPageDto {
  @ApiProperty({ type: [SupplierEightDTaskDto] }) items!: SupplierEightDTaskDto[];
  @ApiProperty() examined!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) nextCursor!: string | null;
}

export class SupplierEightDNotificationPageDto {
  @ApiProperty({ type: [SupplierEightDNotificationDto] }) items!: SupplierEightDNotificationDto[];
  @ApiProperty() examined!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) nextCursor!: string | null;
}
