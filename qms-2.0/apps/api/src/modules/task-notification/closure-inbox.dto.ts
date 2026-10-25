import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import type { WorkflowClosureDuty } from '../workflow/workflow-closure-round.types.js';
import { InboxPageQueryDto } from './task-inbox.dto.js';

const DUTIES = ['PROFESSIONAL', 'SECTION_MANAGER', 'MINISTER'] as const;

export class ClosureInboxQueryDto extends InboxPageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  problemId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  roundId?: string;
}

export class ClosureTaskDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) roundId!: string;
  @ApiProperty({ minimum: 1 }) roundVersion!: number;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty({ format: 'uuid' }) workflowVersionId!: string;
  @ApiProperty({ enum: DUTIES }) duty!: WorkflowClosureDuty;
  @ApiProperty({ enum: ['PENDING'] }) status!: 'PENDING';
  @ApiProperty({ minimum: 1 }) contentVersion!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() canAct!: boolean;
  @ApiProperty() requiresJointConfirmation!: boolean;
  @ApiProperty({ enum: DUTIES, isArray: true }) jointDuties!: WorkflowClosureDuty[];
}

export class ClosureTaskPageDto {
  @ApiProperty({ type: [ClosureTaskDto] }) items!: ClosureTaskDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
}

export class ClosureNotificationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) roundId!: string;
  @ApiProperty({ minimum: 1 }) roundVersion!: number;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty({ enum: ['CLOSURE_PENDING'] }) kind!: 'CLOSURE_PENDING';
  @ApiProperty() subject!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ format: 'date-time' }) deliveredAt!: string;
  @ApiProperty({ enum: DUTIES, isArray: true }) duties!: WorkflowClosureDuty[];
  @ApiProperty() requiresJointConfirmation!: boolean;
  @ApiProperty({ enum: DUTIES, isArray: true }) jointDuties!: WorkflowClosureDuty[];
}

export class ClosureNotificationPageDto {
  @ApiProperty({ type: [ClosureNotificationDto] }) items!: ClosureNotificationDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
}
