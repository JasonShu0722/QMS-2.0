import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { WorkflowDeadlineStage } from '../workflow/workflow-deadline-extension.types.js';
import type { ProcessEightDNotificationKind } from './process-eight-d-reminder.service.js';

export type ProcessEightDTaskAction = 'OPEN_REPORT' | 'ANALYSIS_COMPLETE' | 'SUBMIT' | 'REQUEST_EXTENSION' | 'DECIDE_EXTENSION';
export class ProcessEightDTaskQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() problemId?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset?: number;
}
export class ProcessEightDTaskDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty({ format: 'uuid' }) workflowVersionId!: string;
  @ApiProperty({ enum: ['HANDLING', 'EXTENSION'] }) kind!: 'HANDLING' | 'EXTENSION';
  @ApiProperty({ enum: ['ANALYSIS', 'SUBMISSION', 'CLOSURE'] }) stage!: WorkflowDeadlineStage;
  @ApiProperty({ enum: ['HANDLING', 'LEADER_PENDING', 'QUALITY_PENDING'] }) status!: 'HANDLING' | 'LEADER_PENDING' | 'QUALITY_PENDING';
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() rowVersion!: number;
  @ApiProperty() contentVersion!: number;
  @ApiProperty() instanceVersion!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) dueAt!: string | null;
  @ApiProperty() overdue!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) extensionRequestId!: string | null;
  @ApiProperty({ type: Number, nullable: true }) extensionRequestVersion!: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) requestedDueAt!: string | null;
  @ApiProperty({ enum: ['ANALYSIS', 'SUBMISSION', 'CLOSURE'], isArray: true }) extensionStages!: WorkflowDeadlineStage[];
  @ApiProperty({ enum: ['OPEN_REPORT', 'ANALYSIS_COMPLETE', 'SUBMIT', 'REQUEST_EXTENSION', 'DECIDE_EXTENSION'], isArray: true }) actions!: ProcessEightDTaskAction[];
}
export class ProcessEightDTaskPageDto {
  @ApiProperty({ type: [ProcessEightDTaskDto] }) items!: ProcessEightDTaskDto[];
  @ApiProperty() total!: number;
}
export class ProcessEightDNotificationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty({ enum: ['HANDLING_REMINDER', 'EXTENSION_PENDING', 'EXTENSION_CANCELLED', 'CLOSURE_REMINDER'] }) kind!: ProcessEightDNotificationKind;
  @ApiProperty() subject!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ format: 'date-time' }) deliveredAt!: string;
}
export class ProcessEightDNotificationPageDto {
  @ApiProperty({ type: [ProcessEightDNotificationDto] }) items!: ProcessEightDNotificationDto[];
  @ApiProperty() total!: number;
}
