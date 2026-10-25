import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsUUID, ValidateIf, IsInt, Min, Max, IsOptional, IsString, MaxLength } from 'class-validator';
import type { WorkflowClosureDuty, WorkflowClosurePolicy, WorkflowClosureSeverity } from './workflow-closure-policy.js';

export class WorkflowClosureOptionsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) search?: string;
}
export class WorkflowClosureDepartmentOptionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}
export class WorkflowClosureUserOptionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ type: String, nullable: true }) fullName!: string | null;
}
export class WorkflowClosureOptionsDto {
  @ApiProperty({ type: [WorkflowClosureDepartmentOptionDto] }) departments!: WorkflowClosureDepartmentOptionDto[];
  @ApiProperty({ type: [WorkflowClosureUserOptionDto] }) users!: WorkflowClosureUserOptionDto[];
  @ApiProperty() departmentTotal!: number;
  @ApiProperty() userTotal!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class WorkflowClosurePreviewInputDto {
  @ApiProperty({ enum: ['INTERNAL', 'SUPPLIER'] }) @IsIn(['INTERNAL', 'SUPPLIER']) policy!: WorkflowClosurePolicy;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }) @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) severity!: WorkflowClosureSeverity;
  @ApiProperty({ format: 'uuid' }) @IsUUID() responsibleSectionDepartmentId!: string;
  @ApiProperty({ format: 'uuid', description: 'Configuration test identity only, not the issuer of a running problem.' }) @IsUUID() professionalUserId!: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Required only for INTERNAL; supplier owner identity is not accepted.' })
  @ValidateIf(input => input.policy === 'INTERNAL') @IsUUID() ownerUserId?: string;
}

export class WorkflowClosureParticipantDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ type: String, nullable: true }) fullName!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) assignmentId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) positionId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) departmentId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) bindingId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) scopeId!: string | null;
  @ApiProperty({ type: Number, nullable: true }) bindingVersion!: number | null;
  @ApiProperty({ type: Number, nullable: true }) scopeVersion!: number | null;
}

export class WorkflowClosurePreviewDutyDto {
  @ApiProperty({ enum: ['PROFESSIONAL', 'SECTION_MANAGER', 'MINISTER'] }) duty!: WorkflowClosureDuty;
  @ApiProperty({ enum: ['PENDING', 'WAITING', 'SKIPPED_SAME_PERSON'] }) status!: 'PENDING' | 'WAITING' | 'SKIPPED_SAME_PERSON';
  @ApiProperty({ type: WorkflowClosureParticipantDto, nullable: true }) participant!: WorkflowClosureParticipantDto | null;
}

export class WorkflowClosurePreviewIssueDto {
  @ApiProperty({ enum: ['OWNER', 'PROFESSIONAL', 'SECTION_MANAGER', 'MINISTER'] }) duty!: 'OWNER' | WorkflowClosureDuty;
  @ApiProperty({ enum: ['PARTICIPANT_NOT_ELIGIBLE', 'STRUCTURE_INACTIVE', 'BINDING_MISSING', 'BINDING_AMBIGUOUS', 'ASSIGNMENT_MISSING', 'ASSIGNMENT_AMBIGUOUS', 'SCOPE_MISSING', 'SCOPE_AMBIGUOUS'] })
  code!: 'PARTICIPANT_NOT_ELIGIBLE' | 'STRUCTURE_INACTIVE' | 'BINDING_MISSING' | 'BINDING_AMBIGUOUS' | 'ASSIGNMENT_MISSING' | 'ASSIGNMENT_AMBIGUOUS' | 'SCOPE_MISSING' | 'SCOPE_AMBIGUOUS';
}

export class WorkflowClosureSamePersonGroupDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ enum: ['SECTION_MANAGER', 'MINISTER'], isArray: true }) duties!: WorkflowClosureDuty[];
}

export class WorkflowClosurePreviewDto {
  @ApiProperty({ type: Boolean, example: true, readOnly: true, description: 'Always true: read-only configuration preview, never approval or execution authorization.' }) previewOnly!: true;
  @ApiProperty() configurationReady!: boolean;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) sectionDepartmentId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) at!: string;
  @ApiProperty({ enum: ['PARALLEL', 'PROFESSIONAL_THEN_MANAGEMENT'] }) executionMode!: 'PARALLEL' | 'PROFESSIONAL_THEN_MANAGEMENT';
  @ApiProperty({ type: [WorkflowClosurePreviewDutyDto] }) duties!: WorkflowClosurePreviewDutyDto[];
  @ApiProperty({ type: [WorkflowClosureSamePersonGroupDto] }) samePersonGroups!: WorkflowClosureSamePersonGroupDto[];
  @ApiProperty({ type: [WorkflowClosurePreviewIssueDto] }) issues!: WorkflowClosurePreviewIssueDto[];
}
