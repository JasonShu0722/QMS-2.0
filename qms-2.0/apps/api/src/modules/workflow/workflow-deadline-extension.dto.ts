import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { WorkflowDeadlineStage, WorkflowDeadlineStatus } from './workflow-deadline-extension.types.js';

export class RequestWorkflowDeadlineExtensionDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedRowVersion!: number;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedInstanceVersion!: number;
  @ApiProperty({ enum: ['ANALYSIS', 'SUBMISSION', 'CLOSURE'] }) @IsIn(['ANALYSIS', 'SUBMISSION', 'CLOSURE']) stage!: WorkflowDeadlineStage;
  @ApiProperty({ format: 'date-time' }) @IsISO8601({ strict: true }) requestedDueAt!: string;
  @ApiProperty({ maxLength: 2000 }) @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
export class DecideWorkflowDeadlineExtensionDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @ApiProperty({ enum: ['APPROVE', 'RETURN'] }) @IsIn(['APPROVE', 'RETURN']) decision!: 'APPROVE' | 'RETURN';
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}
export class WorkflowDeadlineHistoryDto {
  @ApiProperty() action!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) userId!: string | null;
  @ApiProperty() comment!: string;
  @ApiProperty({ format: 'date-time' }) at!: string;
}
export class WorkflowDeadlineExtensionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty({ format: 'uuid' }) workflowVersionId!: string;
  @ApiProperty({ enum: ['ANALYSIS', 'SUBMISSION', 'CLOSURE'] }) stage!: WorkflowDeadlineStage;
  @ApiProperty({ format: 'date-time' }) originalDueAt!: string;
  @ApiProperty({ format: 'date-time' }) requestedDueAt!: string;
  @ApiProperty() originallyOverdue!: boolean;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'uuid' }) applicantUserId!: string;
  @ApiProperty({ format: 'uuid' }) leaderUserId!: string;
  @ApiProperty({ format: 'uuid' }) professionalUserId!: string;
  @ApiProperty() leaderSkipped!: boolean;
  @ApiProperty({ enum: ['LEADER_PENDING', 'QUALITY_PENDING', 'APPROVED', 'RETURNED', 'CANCELLED'] }) status!: WorkflowDeadlineStatus;
  @ApiProperty() version!: number;
  @ApiProperty({ type: [WorkflowDeadlineHistoryDto] }) history!: WorkflowDeadlineHistoryDto[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
