import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PROBLEM_STATUSES, type ProblemStatus } from './problem.types.js';

export class ProblemIndexQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() organizationId?: string;
  @ApiPropertyOptional({ minimum: 1, default: 1 }) @IsOptional() @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 }) @IsOptional() @IsInt() @Min(1) @Max(100) pageSize = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() domainCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() problemType?: string;
  @ApiPropertyOptional({ enum: PROBLEM_STATUSES }) @IsOptional() @IsEnum(PROBLEM_STATUSES) status?: ProblemStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() severity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
}

export class ProblemIndexResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty() domainCode!: string;
  @ApiProperty() problemType!: string;
  @ApiProperty() sourceType!: string;
  @ApiPropertyOptional() sourceId?: string;
  @ApiProperty({ enum: PROBLEM_STATUSES }) status!: ProblemStatus;
  @ApiProperty() severity!: string;
  @ApiPropertyOptional() responsibleParty?: string;
  @ApiPropertyOptional() dueAt?: string;
  @ApiProperty() version!: number;
}

export class ProblemIndexPageResponseDto {
  @ApiProperty({ type: [ProblemIndexResponseDto] }) items!: ProblemIndexResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

