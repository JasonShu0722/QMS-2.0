import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { PROBLEM_STATUSES, type ProblemStatus } from './problem.types.js';
import { DOMAIN_SOURCE_RESPONSE_FORMS, type DomainSourceResponseForm } from './domain-source-issue.service.js';

export const PROBLEM_SORT_FIELDS = ['createdAt', 'updatedAt', 'dueAt', 'reportNumber', 'status', 'severity'] as const;

export class ProblemScopeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}

export class ProblemIndexQueryDto extends ProblemScopeQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 10001, default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10001) page?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) domainCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) problemType?: string;
  @ApiPropertyOptional({ enum: DOMAIN_SOURCE_RESPONSE_FORMS }) @IsOptional() @IsIn(DOMAIN_SOURCE_RESPONSE_FORMS) responseForm?: DomainSourceResponseForm;
  @ApiPropertyOptional({ enum: PROBLEM_STATUSES }) @IsOptional() @IsIn(PROBLEM_STATUSES) status?: ProblemStatus;
  @ApiPropertyOptional({ maxLength: 32 }) @IsOptional() @IsString() @MaxLength(32) severity?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) dueFrom?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) dueTo?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) overdueAt?: string;
  @ApiPropertyOptional({ enum: PROBLEM_SORT_FIELDS, default: 'createdAt' }) @IsOptional() @IsIn(PROBLEM_SORT_FIELDS) sortBy?: typeof PROBLEM_SORT_FIELDS[number];
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' }) @IsOptional() @IsIn(['asc', 'desc']) sortDirection?: 'asc' | 'desc';
}

export class ProblemFieldDto {
  @ApiProperty({ maxLength: 100, pattern: '^[A-Za-z][A-Za-z0-9._:-]{0,99}$' }) key!: string;
  @ApiProperty({ maxLength: 200 }) label!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 20000 }) value!: string | null;
}

export class ProblemDomainSummaryDto {
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() domainUiKey!: string;
  @ApiPropertyOptional({ type: [ProblemFieldDto], maxItems: 50 }) fields?: ProblemFieldDto[];
}

export class ProblemIndexResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty() domainCode!: string;
  @ApiProperty() problemType!: string;
  @ApiProperty() sourceType!: string;
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
  @ApiProperty({ enum: PROBLEM_STATUSES }) status!: ProblemStatus;
  @ApiProperty() severity!: string;
  @ApiProperty({ type: String, nullable: true }) responsibleParty!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) ownerId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) dueAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: ProblemDomainSummaryDto }) summary!: ProblemDomainSummaryDto;
}

export class ProblemStatusCountDto {
  @ApiProperty({ enum: PROBLEM_STATUSES }) status!: ProblemStatus;
  @ApiProperty() count!: number;
}

export class ProblemIndexPageResponseDto {
  @ApiProperty({ type: [ProblemIndexResponseDto] }) items!: ProblemIndexResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty({ type: [ProblemStatusCountDto] }) statusCounts!: ProblemStatusCountDto[];
}

