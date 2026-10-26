import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProcessEightDDocumentDto } from './process-eight-d-document.dto.js';
import { WorkflowClosureOptionsDto, WorkflowClosureOptionsQueryDto } from '../workflow/workflow-closure-preview.dto.js';

export class ProcessEightDAssignmentOptionsQueryDto extends WorkflowClosureOptionsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ enum: ['ISSUE', 'REASSIGN', 'COLLABORATORS'], default: 'ISSUE' }) @IsIn(['ISSUE', 'REASSIGN', 'COLLABORATORS']) action: 'ISSUE' | 'REASSIGN' | 'COLLABORATORS' = 'ISSUE';
  @ApiPropertyOptional({ format: 'uuid', description: 'Required for REASSIGN and COLLABORATORS.' }) @IsOptional() @IsUUID() problemId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() sectionDepartmentId?: string;
}
export class ProcessEightDAssignmentOptionsDto extends WorkflowClosureOptionsDto {}

export class ProcessEightDScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}
export class ProcessEightDVersionDto extends ProcessEightDScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}
export class ProcessEightDSourceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() defectId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}
export class ProcessEightDSourcePreviewInputDto extends ProcessEightDScopeDto {
  @ApiProperty({ type: [ProcessEightDSourceDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ProcessEightDSourceDto) sources!: ProcessEightDSourceDto[];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() problemId?: string;
}
export class ProcessEightDRelatedProblemDto {
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty() title!: string;
  @ApiProperty() status!: string;
  @ApiProperty() primary!: boolean;
}
export class ProcessEightDSourcePreviewDto {
  @ApiProperty({ format: 'uuid' }) defectId!: string;
  @ApiProperty({ type: [ProcessEightDRelatedProblemDto] }) relatedProblems!: ProcessEightDRelatedProblemDto[];
  @ApiProperty() hasHiddenRelations!: boolean;
  @ApiProperty({ description: 'Opaque confirmation fingerprint; revalidated inside the mutation transaction.' }) relatedSetToken!: string;
}
export class ProcessEightDSourceConfirmationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() defectId!: string;
  @ApiProperty({ type: [String], format: 'uuid' }) @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all', { each: true }) relatedProblemIds!: string[];
  @ApiProperty({ enum: ['RECURRENCE', 'NOT_RECURRENCE'] }) @IsIn(['RECURRENCE', 'NOT_RECURRENCE']) recurrence!: 'RECURRENCE' | 'NOT_RECURRENCE';
  @ApiPropertyOptional({ description: 'Fingerprint returned by sources/preview; required when hidden relations exist.' }) @IsOptional() @IsString() @MinLength(64) @MaxLength(64) relatedSetToken?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
export class IssueProcessEightDDto extends ProcessEightDScopeDto {
  @ApiProperty({ type: [ProcessEightDSourceDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ProcessEightDSourceDto) sources!: ProcessEightDSourceDto[];
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }) @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) severity!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  @ApiProperty({ format: 'uuid' }) @IsUUID() ownerUserId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() responsibleSectionDepartmentId!: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() analysisDueAt?: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() closureDueAt?: Date;
  @ApiPropertyOptional({ type: [ProcessEightDSourceConfirmationDto] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ProcessEightDSourceConfirmationDto) sourceConfirmations?: ProcessEightDSourceConfirmationDto[];
}
export class SaveProcessEightDDto extends ProcessEightDVersionDto {
  @ApiProperty({ type: ProcessEightDDocumentDto }) @ValidateNested() @Type(() => ProcessEightDDocumentDto) document!: ProcessEightDDocumentDto;
}
export class ProcessEightDCollaboratorsDto extends ProcessEightDVersionDto {
  @ApiProperty({ type: [String], format: 'uuid' }) @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all', { each: true }) userIds!: string[];
}
export class ReassignProcessEightDDto extends ProcessEightDVersionDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() ownerUserId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() responsibleSectionDepartmentId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
export class ProcessEightDRiskDto extends ProcessEightDVersionDto {
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }) @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) severity!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirmCancelApproval?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
export class ProcessEightDSourcesDto extends ProcessEightDVersionDto {
  @ApiProperty({ type: [ProcessEightDSourceDto] }) @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ProcessEightDSourceDto) add!: ProcessEightDSourceDto[];
  @ApiProperty({ type: [String], format: 'uuid' }) @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all', { each: true }) removeDefectIds!: string[];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() primaryDefectId?: string;
  @ApiPropertyOptional({ type: [ProcessEightDSourceConfirmationDto] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ProcessEightDSourceConfirmationDto) sourceConfirmations?: ProcessEightDSourceConfirmationDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirmCancelApproval?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
export class ProcessEightDAnalysisCompleteDto extends ProcessEightDVersionDto {
  @ApiProperty({ type: String, format: 'date-time' }) @Type(() => Date) @IsDate() submissionDueAt!: Date;
}
export class ProcessEightDDeadlinesDto extends ProcessEightDVersionDto {
  @ApiPropertyOptional({ type: String, format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() analysisDueAt?: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() closureDueAt?: Date;
}
export class ProcessEightDBindingDto extends ProcessEightDScopeDto {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) expectedVersion!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() workflowDefinitionId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() workflowVersionId!: string;
}
export class ProcessEightDActivationDto extends ProcessEightDVersionDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
}
export class ProcessEightDBindingResultDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) workflowDefinitionId!: string;
  @ApiProperty({ format: 'uuid' }) workflowVersionId!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() version!: number;
}
export class ProcessEightDSourceSnapshotDto {
  @ApiProperty({ format: 'uuid' }) defectId!: string;
  @ApiProperty() sourceVersion!: number;
  @ApiProperty({ type: Object, additionalProperties: true }) snapshot!: Record<string, unknown>;
  @ApiProperty() primary!: boolean;
}
export class ProcessEightDRevisionSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() contentVersion!: number;
  @ApiProperty({ type: String, format: 'date-time' }) recordedAt!: string;
}
export class ProcessEightDReportDto {
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) instanceId!: string;
  @ApiProperty({ format: 'uuid' }) workflowVersionId!: string;
  @ApiProperty() instanceVersion!: number;
  @ApiProperty() problemVersion!: number;
  @ApiProperty() version!: number;
  @ApiProperty() contentVersion!: number;
  @ApiProperty() status!: string;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }) severity!: string;
  @ApiProperty({ format: 'uuid' }) ownerUserId!: string;
  @ApiProperty({ format: 'uuid' }) professionalUserId!: string;
  @ApiProperty({ format: 'uuid' }) responsibleSectionDepartmentId!: string;
  @ApiProperty({ type: [String] }) collaboratorUserIds!: string[];
  @ApiProperty({ type: ProcessEightDDocumentDto }) document!: ProcessEightDDocumentDto;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) analysisCompletedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) analysisDueAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) submissionDueAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closureDueAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) submittedAt!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) closedRevisionId!: string | null;
  @ApiProperty({ type: [String] }) allowedActions!: string[];
  @ApiProperty({ type: [ProcessEightDSourceSnapshotDto] }) sources!: ProcessEightDSourceSnapshotDto[];
  @ApiProperty({ type: [ProcessEightDRevisionSummaryDto] }) revisions!: ProcessEightDRevisionSummaryDto[];
}
