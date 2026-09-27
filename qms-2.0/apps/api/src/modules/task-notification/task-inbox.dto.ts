import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { WORKFLOW_NODE_TYPES } from '../workflow/workflow.types.js';

export class InboxScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  organizationId?: string;
}

export class InboxPageQueryDto extends InboxScopeDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000)
  offset?: number;
}

export class TaskQueryDto extends InboxPageQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'IN_PROGRESS', 'OVERDUE', 'FAILED'] }) @IsOptional() @IsIn(['PENDING', 'IN_PROGRESS', 'OVERDUE', 'FAILED'])
  status?: 'PENDING' | 'IN_PROGRESS' | 'OVERDUE' | 'FAILED';
  @ApiPropertyOptional({ enum: ['UNCLAIMED', 'MINE', 'OTHERS'] }) @IsOptional() @IsIn(['UNCLAIMED', 'MINE', 'OTHERS'])
  claim?: 'UNCLAIMED' | 'MINE' | 'OTHERS';
}

export class TaskStatisticsDto {
  @ApiProperty() total!: number;
  @ApiProperty() pending!: number;
  @ApiProperty() inProgress!: number;
  @ApiProperty() overdue!: number;
  @ApiProperty() unclaimed!: number;
  @ApiProperty() mine!: number;
  @ApiProperty() dueToday!: number;
  @ApiProperty() dueThisWeek!: number;
  @ApiProperty() failed!: number;
}

export class NotificationQueryDto extends InboxPageQueryDto {
  @ApiPropertyOptional({ enum: ['UNREAD', 'READ'] }) @IsOptional() @IsIn(['UNREAD', 'READ'])
  status?: 'UNREAD' | 'READ';
}

export class InboxMutationDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647)
  expectedVersion!: number;
}

export class TaskTransferItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}

export class TaskTransferDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() assigneeUserId!: string;
  @ApiProperty({ type: [TaskTransferItemDto], minItems: 1, maxItems: 100 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TaskTransferItemDto) items!: TaskTransferItemDto[];
}

export class TaskTransferResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ format: 'uuid' }) assigneeUserId!: string;
  @ApiProperty({ enum: ['PENDING', 'IN_PROGRESS', 'OVERDUE'] }) status!: string;
}

export class TaskDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) instanceId!: string;
  @ApiProperty({ format: 'uuid' }) fixedVersion!: string;
  @ApiProperty({ minimum: 1 }) entryInstanceVersion!: number;
  @ApiProperty({ format: 'uuid' }) nodeId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: WORKFLOW_NODE_TYPES }) type!: string;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) dueAt!: string | null;
  @ApiProperty({ enum: ['PENDING', 'IN_PROGRESS', 'OVERDUE', 'FAILED'] }) status!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) claimedByUserId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) claimedAt!: string | null;
  @ApiProperty() canAct!: boolean;
  @ApiProperty() canClaim!: boolean;
  @ApiProperty() canRelease!: boolean;
  @ApiProperty() canRetry!: boolean;
}

export class TaskPageDto {
  @ApiProperty({ type: [TaskDto] }) items!: TaskDto[];
  @ApiProperty() total!: number;
}

export class NotificationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) taskId!: string;
  @ApiProperty({ format: 'uuid' }) instanceId!: string;
  @ApiProperty({ format: 'uuid' }) fixedVersion!: string;
  @ApiProperty({ format: 'uuid' }) nodeId!: string;
  @ApiProperty() nodeName!: string;
  @ApiProperty({ enum: ['TASK_ASSIGNED', 'TASK_REMINDER', 'TASK_ESCALATED'] }) kind!: string;
  @ApiProperty({ type: String, nullable: true }) subject!: string | null;
  @ApiProperty() body!: string;
  @ApiProperty({ enum: ['DELIVERED'] }) status!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) readAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class NotificationPageDto {
  @ApiProperty({ type: [NotificationDto] }) items!: NotificationDto[];
  @ApiProperty() total!: number;
}
