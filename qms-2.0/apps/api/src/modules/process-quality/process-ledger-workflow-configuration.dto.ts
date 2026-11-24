import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum, IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export const ProcessLedgerBoard = {
  REGISTRATION: 'REGISTRATION',
  ANALYSIS: 'ANALYSIS',
  RESPONSIBILITY: 'RESPONSIBILITY',
  DISPOSITION: 'DISPOSITION',
  CLOSURE: 'CLOSURE',
} as const;
export type ProcessLedgerBoard = (typeof ProcessLedgerBoard)[keyof typeof ProcessLedgerBoard];
export const PROCESS_LEDGER_CONFIGURATION_BOARDS = Object.values(ProcessLedgerBoard);

const ProcessLedgerCapability = { ...ProcessLedgerBoard, MATERIAL_REVIEW: 'MATERIAL_REVIEW' } as const;
export type ProcessLedgerCapability = (typeof ProcessLedgerCapability)[keyof typeof ProcessLedgerCapability];

class ProcessLedgerBoardPositionsDto {
  @ApiProperty({ enum: ProcessLedgerBoard })
  @IsEnum(ProcessLedgerBoard)
  board!: ProcessLedgerBoard;

  @ApiProperty({ type: [String], format: 'uuid', uniqueItems: true })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  positionIds!: string[];
}

class ProcessLedgerPositionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class ProcessLedgerWorkflowConfigurationDto {
  @ApiProperty({ type: Number, minimum: 0 }) version!: number;
  @ApiProperty({ type: [ProcessLedgerBoardPositionsDto] }) boards!: ProcessLedgerBoardPositionsDto[];
  @ApiProperty({ type: [ProcessLedgerPositionDto] }) positions!: ProcessLedgerPositionDto[];
}

export class UpdateProcessLedgerWorkflowConfigurationDto {
  @ApiProperty({ type: Number, minimum: 0, maximum: 2147483646 })
  @IsInt() @Min(0) @Max(2147483646)
  expectedVersion!: number;

  @ApiProperty({ type: [ProcessLedgerBoardPositionsDto], maxItems: PROCESS_LEDGER_CONFIGURATION_BOARDS.length })
  @IsArray()
  @ArrayMaxSize(PROCESS_LEDGER_CONFIGURATION_BOARDS.length)
  @ArrayUnique((item: ProcessLedgerBoardPositionsDto | null) => item?.board)
  @ValidateNested({ each: true })
  @Type(() => ProcessLedgerBoardPositionsDto)
  boards!: ProcessLedgerBoardPositionsDto[];
}

export class ProcessLedgerWorkflowCapabilitiesDto {
  @ApiProperty({ enum: ProcessLedgerCapability, isArray: true })
  boards!: ProcessLedgerCapability[];
}
