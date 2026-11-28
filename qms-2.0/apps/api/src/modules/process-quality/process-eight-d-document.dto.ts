import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsString, IsUUID,
  Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';

export const PROCESS_EIGHT_D_MAX_ROWS = 100;
export const PROCESS_EIGHT_D_MAX_FILES = 100;
export const PROCESS_EIGHT_D_MAX_TEXT = 10000;

export class ProcessEightDSubmissionIssueDto {
  @ApiProperty() path!: string;
  @ApiProperty() message!: string;
}

function Text(maxLength = PROCESS_EIGHT_D_MAX_TEXT) {
  return applyDecorators(ApiProperty({ type: String, maxLength }), IsString(), MaxLength(maxLength));
}

function Identifier() {
  return applyDecorators(Text(128), MinLength(1), Matches(/\S/));
}

function NullableDate() {
  return applyDecorators(
    ApiProperty({ type: String, nullable: true, maxLength: 64, description: '明确选择的 YYYY-MM-DD 日期或带时区的 ISO 8601 时间；未知为 null' }),
    ValidateIf((_object, value) => value !== null), IsString(), MaxLength(64),
    Matches(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/),
    IsISO8601({ strict: true, strictSeparator: true }),
  );
}

function NullableCount() {
  return applyDecorators(
    ApiProperty({ type: 'integer', nullable: true, minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    ValidateIf((_object, value) => value !== null), IsInt(), Min(0), Max(Number.MAX_SAFE_INTEGER),
  );
}

function NullableBoolean() {
  return applyDecorators(ApiProperty({ type: Boolean, nullable: true }), ValidateIf((_object, value) => value !== null), IsBoolean());
}

function FileIds(optional = false) {
  const property = optional ? ApiPropertyOptional : ApiProperty;
  return applyDecorators(
    property({ type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: PROCESS_EIGHT_D_MAX_FILES }),
    ...(optional ? [ValidateIf((_object, value) => value !== undefined)] : []),
    IsArray(), ArrayMaxSize(PROCESS_EIGHT_D_MAX_FILES), IsUUID('all', { each: true }),
  );
}

function Rows(type: new () => object) {
  return applyDecorators(
    ApiProperty({ type: () => type, isArray: true, maxItems: PROCESS_EIGHT_D_MAX_ROWS }),
    IsArray(), ArrayMaxSize(PROCESS_EIGHT_D_MAX_ROWS), ValidateNested({ each: true }), Type(() => type),
  );
}

function OptionalText(maxLength = PROCESS_EIGHT_D_MAX_TEXT) {
  return applyDecorators(ApiPropertyOptional({ type: String, maxLength }), ValidateIf((_object, value) => value !== undefined), IsString(), MaxLength(maxLength));
}

export class ProcessEightDTeamMemberDto {
  @Identifier() id = '';
  @Text(200) name = '';
  @Text(200) department = '';
  @Text() responsibility = '';
  @Text() collaborationScope = '';
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined) @IsUUID('all')
  userId?: string = undefined;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== undefined && value !== null) @IsUUID('all')
  assignmentId?: string | null = undefined;
  @OptionalText(200) jobTitle?: string = undefined;
  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  isLeader?: boolean = undefined;
}

export class ProcessEightDTemporaryMeasureDto {
  @Identifier() id = '';
  @Text() description = '';
  @Text(200) departmentOwner = '';
  @NullableDate() introducedAt: string | null = null;
  @FileIds() fileIds: string[] = [];
}

export class ProcessEightDContainmentDto {
  @Identifier() id = '';
  @Text(200) group = '';
  @Text(200) location = '';
  @NullableCount() quantity: number | null = null;
  @Text() measure = '';
  @Text(200) owner = '';
  @NullableDate() plannedAt: string | null = null;
  @Text() completion = '';
  @NullableCount() ngQuantity: number | null = null;
}

export class ProcessEightDCorrectiveActionDto {
  @Identifier() id = '';
  @ApiProperty({ type: String, enum: ['OCCURRENCE', 'ESCAPE', 'SYSTEM'] })
  @IsIn(['OCCURRENCE', 'ESCAPE', 'SYSTEM'])
  causeKind!: 'OCCURRENCE' | 'ESCAPE' | 'SYSTEM';
  @Text() action = '';
  @Text(200) owner = '';
  @NullableDate() plannedAt: string | null = null;
  @Text() verificationMethod = '';
  @OptionalText() selectionReason?: string = undefined;
  @FileIds() fileIds: string[] = [];
  @NullableDate() implementationAt: string | null = null;
  @OptionalText(200) implementer?: string = undefined;
  @OptionalText(200) verifier?: string = undefined;
  @Text() result = '';
  @Text() beforeState = '';
  @Text() afterState = '';
  @Text(200) firstBatch = '';
  @NullableCount() followUpBatchCount: number | null = null;
  @Text() followUpDuration = '';
  @Text() verificationRecord = '';
  @FileIds() verificationFileIds: string[] = [];
  @NullableBoolean() effective: boolean | null = null;
}

export class ProcessEightDHorizontalDeploymentDto {
  @Identifier() id = '';
  @Text() scope = '';
  @Text() inspectionResult = '';
  @Text() action = '';
  @Text(200) owner = '';
  @Text() completion = '';
  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  completed?: boolean = undefined;
  @FileIds() fileIds: string[] = [];
}

export class ProcessEightDStandardizationDto {
  @Identifier() id = '';
  @Identifier() key = '';
  @Text(200) documentName = '';
  @NullableBoolean() needsUpdate: boolean | null = null;
  @Text(200) departmentOwner = '';
  @NullableDate() plannedAt: string | null = null;
  @NullableDate() completedAt: string | null = null;
  @ApiProperty({ type: String, maxLength: 100, description: 'COMPLETED 表示本项完成，NOT_APPLICABLE 表示不适用' })
  @IsString() @MaxLength(100) status = '';
  @Text() reason = '';
  @ApiPropertyOptional({ type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: PROCESS_EIGHT_D_MAX_FILES })
  @ValidateIf((_object, value) => value !== undefined) @IsArray() @ArrayMaxSize(PROCESS_EIGHT_D_MAX_FILES) @IsUUID('all', { each: true })
  fileIds?: string[] = undefined;
}

export class ProcessEightDEffectTrackingDto {
  @NullableDate() startDate: string | null = null;
  @Text(200) startOrderNumber = '';
  @NullableCount() productionQuantity: number | null = null;
  @NullableCount() defectQuantity: number | null = null;
  @Text() result = '';
  @Text(200) judgement = '';
}

export class ProcessEightDDocumentDto {
  @OptionalText() title?: string = undefined;
  @ApiPropertyOptional({ type: () => ProcessEightDTeamMemberDto, isArray: true, maxItems: PROCESS_EIGHT_D_MAX_ROWS })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray() @ArrayMaxSize(PROCESS_EIGHT_D_MAX_ROWS) @ValidateNested({ each: true }) @Type(() => ProcessEightDTeamMemberDto)
  team?: ProcessEightDTeamMemberDto[] = undefined;
  @OptionalText() riskAssessment?: string = undefined;
  @Text() description = '';
  @OptionalText() okDescription?: string = undefined;
  @OptionalText() ngDescription?: string = undefined;
  @FileIds() okFileIds: string[] = [];
  @FileIds() ngFileIds: string[] = [];
  @Rows(ProcessEightDTemporaryMeasureDto) temporaryMeasures: ProcessEightDTemporaryMeasureDto[] = [];
  @Rows(ProcessEightDContainmentDto) containment: ProcessEightDContainmentDto[] = [];
  @Rows(ProcessEightDContainmentDto) optionalAffectedContainment: ProcessEightDContainmentDto[] = [];
  @OptionalText() optionalAffectedScope?: string = undefined;
  @Text() analysisProcess = '';
  @FileIds() analysisFileIds: string[] = [];
  @Text() occurrenceCause = '';
  @Text() escapeCause = '';
  @Text() systemCause = '';
  @Rows(ProcessEightDCorrectiveActionDto) correctiveActions: ProcessEightDCorrectiveActionDto[] = [];
  @ApiPropertyOptional({ type: () => ProcessEightDEffectTrackingDto })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject() @ValidateNested() @Type(() => ProcessEightDEffectTrackingDto)
  effectTracking?: ProcessEightDEffectTrackingDto = undefined;
  @Rows(ProcessEightDHorizontalDeploymentDto) horizontalDeployment: ProcessEightDHorizontalDeploymentDto[] = [];
  @Rows(ProcessEightDStandardizationDto) standardization: ProcessEightDStandardizationDto[] = [];
  @Text() closureSummary = '';
  @OptionalText() lessonsLearned?: string = undefined;
  @OptionalText() lessonsLearnedTitle?: string = undefined;
  @OptionalText() lessonsLearnedApplicability?: string = undefined;
  @FileIds(true) lessonsLearnedFileIds?: string[] = undefined;
}
