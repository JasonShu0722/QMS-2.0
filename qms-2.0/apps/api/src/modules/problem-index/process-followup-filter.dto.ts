import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { plainToInstance, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsObject, isISO8601, Validate, ValidateNested, validateSync, ValidatorConstraint, type ValidationArguments, type ValidatorConstraintInterface } from 'class-validator';
import { PROBLEM_STATUSES } from './problem.types.js';

export const PROCESS_FOLLOWUP_STAGES = ['ANALYSIS', 'SUBMISSION', 'CLOSURE', 'CLOSURE_REVIEW', 'CLOSED', 'ARCHIVED', 'CANCELLED', 'SUSPENDED', 'FAILED', 'COMPLETED'] as const;
const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const enumOperators = ['EQ', 'NE', 'EMPTY', 'NOT_EMPTY'] as const;
const textOperators = ['CONTAINS', 'NOT_CONTAINS', ...enumOperators] as const;
const dateOperators = ['GTE', 'LTE', 'AFTER', 'BEFORE', ...enumOperators] as const;
const fieldOperators = {
  stage: enumOperators, status: enumOperators, severity: enumOperators,
  responsibleSectionName: textOperators, ownerName: textOperators, dueAt: dateOperators,
};
const fields = Object.keys(fieldOperators);
const logicValues = ['ALL', 'ANY'] as const;
const maxItems = 10;
export const PROCESS_FOLLOWUP_FILTER_MAX_LENGTH = 5500;
type Field = keyof typeof fieldOperators;
type Operator = typeof textOperators[number] | typeof dateOperators[number];

@ValidatorConstraint({ name: 'processFollowupFilterValue' })
class ProcessFollowupFilterValue implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    const { field, operator } = args.object as ProcessFollowupFilterDto;
    if (!Object.hasOwn(fieldOperators, field) || !(fieldOperators[field] as readonly string[]).includes(operator)) return false;
    if (operator === 'EMPTY' || operator === 'NOT_EMPTY') return value === undefined;
    if (typeof value !== 'string' || value.length > 100 || !value.trim()) return false;
    if (field === 'dueAt') return isISO8601(value, { strict: true }) && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
    if (field === 'stage') return (PROCESS_FOLLOWUP_STAGES as readonly string[]).includes(value);
    if (field === 'status') return (PROBLEM_STATUSES as readonly string[]).includes(value);
    if (field === 'severity') return (severities as readonly string[]).includes(value);
    return true;
  }
}

export class ProcessFollowupFilterDto {
  @ApiProperty({ enum: fields }) @IsIn(fields) field!: Field;
  @ApiProperty({ enum: [...new Set([...textOperators, ...dateOperators])] }) @IsIn([...textOperators, ...dateOperators]) operator!: Operator;
  @ApiPropertyOptional({ type: String, maxLength: 100, description: '无值运算符省略；日期使用带时区的 ISO 8601 时间。' }) @Validate(ProcessFollowupFilterValue) value?: string;
}

export class ProcessFollowupFiltersDto {
  @ApiProperty({ enum: logicValues }) @IsIn(logicValues) logic!: typeof logicValues[number];
  @ApiProperty({ type: [ProcessFollowupFilterDto], minItems: 1, maxItems })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(maxItems) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => ProcessFollowupFilterDto)
  items!: ProcessFollowupFilterDto[];
}

export function parseProcessFollowupFilters(query?: string): ProcessFollowupFiltersDto | undefined {
  if (query === undefined) return undefined;
  let value: unknown;
  try { value = JSON.parse(query); } catch { throw new BadRequestException(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  const group = plainToInstance(ProcessFollowupFiltersDto, value);
  if (validateSync(group, { whitelist: true, forbidNonWhitelisted: true }).length) throw new BadRequestException();
  return group;
}
