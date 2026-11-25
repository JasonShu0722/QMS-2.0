import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum, IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export const ProcessEightDWorkflowStage = {
  ISSUE: 'ISSUE',
  ANALYSIS: 'ANALYSIS',
  IMPLEMENTATION: 'IMPLEMENTATION',
  CLOSURE: 'CLOSURE',
} as const;
export type ProcessEightDWorkflowStage = (typeof ProcessEightDWorkflowStage)[keyof typeof ProcessEightDWorkflowStage];
export const PROCESS_EIGHT_D_WORKFLOW_STAGES = Object.values(ProcessEightDWorkflowStage);

class ProcessEightDStagePositionsDto {
  @ApiProperty({ enum: ProcessEightDWorkflowStage })
  @IsEnum(ProcessEightDWorkflowStage)
  stage!: ProcessEightDWorkflowStage;

  @ApiProperty({ type: [String], format: 'uuid', uniqueItems: true })
  @IsArray() @ArrayUnique() @IsUUID('all', { each: true })
  positionIds!: string[];
}

class ProcessEightDWorkflowPositionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class ProcessEightDWorkflowConfigurationDto {
  @ApiProperty({ type: Number, minimum: 0 }) version!: number;
  @ApiProperty({ type: [ProcessEightDStagePositionsDto] }) stages!: ProcessEightDStagePositionsDto[];
  @ApiProperty({ type: [ProcessEightDWorkflowPositionDto] }) positions!: ProcessEightDWorkflowPositionDto[];
  @ApiProperty({ enum: ProcessEightDWorkflowStage, isArray: true }) missingStages!: ProcessEightDWorkflowStage[];
}

export class UpdateProcessEightDWorkflowConfigurationDto {
  @ApiProperty({ type: Number, minimum: 0, maximum: 2147483646 })
  @IsInt() @Min(0) @Max(2147483646)
  expectedVersion!: number;

  @ApiProperty({ type: [ProcessEightDStagePositionsDto], maxItems: PROCESS_EIGHT_D_WORKFLOW_STAGES.length })
  @IsArray() @ArrayMaxSize(PROCESS_EIGHT_D_WORKFLOW_STAGES.length)
  @ArrayUnique((item: ProcessEightDStagePositionsDto | null) => item?.stage)
  @ValidateNested({ each: true }) @Type(() => ProcessEightDStagePositionsDto)
  stages!: ProcessEightDStagePositionsDto[];
}
