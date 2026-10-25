import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { WorkflowClosureDuty } from './workflow-closure-policy.js';

export class StartWorkflowClosureRoundDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedContentVersion!: number;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedInstanceVersion!: number;
}
export class DecideWorkflowClosureRoundDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedRoundVersion!: number;
  @ApiProperty({ enum: ['PROFESSIONAL', 'SECTION_MANAGER', 'MINISTER'], isArray: true, minItems: 1, maxItems: 2 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @ArrayUnique() @IsIn(['PROFESSIONAL', 'SECTION_MANAGER', 'MINISTER'], { each: true }) duties!: WorkflowClosureDuty[];
  @ApiProperty({ enum: ['APPROVE', 'RETURN'] }) @IsIn(['APPROVE', 'RETURN']) decision!: 'APPROVE' | 'RETURN';
  @ApiProperty({ maxLength: 2000 }) @IsString() @Matches(/\S/) @MaxLength(2000) comment!: string;
}
export class CancelWorkflowClosureRoundDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedRoundVersion!: number;
  @ApiProperty({ maxLength: 2000 }) @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
export class WorkflowClosureDutyRecordDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['PROFESSIONAL', 'SECTION_MANAGER', 'MINISTER'] }) duty!: WorkflowClosureDuty;
  @ApiProperty({ enum: ['PENDING', 'WAITING', 'APPROVED', 'SKIPPED_SAME_PERSON', 'CANCELLED'] }) status!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) decidedBy!: string | null;
  @ApiProperty({ type: String, nullable: true }) comment!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) decidedAt!: string | null;
  @ApiProperty() version!: number;
}
export class WorkflowClosureRoundDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty({ format: 'uuid' }) instanceId!: string;
  @ApiProperty({ format: 'uuid' }) workflowVersionId!: string;
  @ApiProperty() contentVersion!: number;
  @ApiProperty() roundNumber!: number;
  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'RETURNED', 'CANCELLED'] }) status!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: [WorkflowClosureDutyRecordDto] }) duties!: WorkflowClosureDutyRecordDto[];
}
