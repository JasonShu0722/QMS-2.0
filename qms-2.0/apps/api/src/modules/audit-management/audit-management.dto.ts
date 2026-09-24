import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { AuditType, ChecklistResult, NcSeverity } from './audit-management.service.js';
export class AuditScopeDto { @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string; }
export class CreateAuditPlanDto extends AuditScopeDto { @ApiProperty() @IsInt() year!: number; @ApiProperty() @IsString() @MaxLength(300) title!: string; @ApiProperty({ enum: ['SYSTEM','PROCESS','PRODUCT','SECOND_PARTY','CUSTOMER'] }) @IsIn(['SYSTEM','PROCESS','PRODUCT','SECOND_PARTY','CUSTOMER']) auditType!: AuditType; @ApiProperty({ format: 'date-time' }) @IsDateString() plannedStart!: string; @ApiProperty({ format: 'date-time' }) @IsDateString() plannedEnd!: string; }
export class UpdateAuditPlanDto extends AuditScopeDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) title?: string; @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() plannedStart?: string; @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() plannedEnd?: string; @ApiPropertyOptional({ enum: ['PLANNED','APPROVED','IN_PROGRESS','COMPLETED','CANCELLED'] }) @IsOptional() @IsIn(['PLANNED','APPROVED','IN_PROGRESS','COMPLETED','CANCELLED']) status?: string; }
export class PostponementDto extends AuditScopeDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; @ApiProperty({ format: 'date-time' }) @IsDateString() proposedStart!: string; @ApiProperty({ format: 'date-time' }) @IsDateString() proposedEnd!: string; @ApiProperty() @IsString() @MaxLength(2000) reason!: string; }
export class DecisionDto extends AuditScopeDto { @ApiProperty() @IsBoolean() approve!: boolean; @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; }
export class CreateAuditTemplateDto extends AuditScopeDto { @ApiProperty() @IsString() @MaxLength(300) name!: string; @ApiProperty({ enum: ['SYSTEM','PROCESS','PRODUCT','SECOND_PARTY','CUSTOMER'] }) @IsIn(['SYSTEM','PROCESS','PRODUCT','SECOND_PARTY','CUSTOMER']) auditType!: AuditType; @ApiProperty({ type: Object }) @IsObject() definition!: Record<string, unknown>; }
export class UpdateAuditTemplateDto extends AuditScopeDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; @ApiProperty({ type: Object }) @IsObject() definition!: Record<string, unknown>; }
export class PublishAuditTemplateDto extends AuditScopeDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; }
export class CreateAuditExecutionDto extends AuditScopeDto { @ApiProperty({ format: 'uuid' }) @IsUUID() planId!: string; @ApiProperty({ format: 'uuid' }) @IsUUID() templateVersionId!: string; }
export class ChecklistResultDto extends AuditScopeDto { @ApiProperty() @IsString() @MaxLength(120) itemKey!: string; @ApiProperty({ enum: ['OK','NG','NA'] }) @IsIn(['OK','NG','NA']) result!: ChecklistResult; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) note?: string; }
export class RegisterAuditDeadlinePolicyDto extends AuditScopeDto { @ApiProperty() @IsString() @MaxLength(100) policyVersion!: string; @ApiProperty() @IsString() @MaxLength(100) calendarVersion!: string; @ApiProperty() @IsString() @MaxLength(100) timeZone!: string; @ApiProperty({ type: [Number] }) @IsArray() workingWeekdays!: number[]; @ApiProperty({ type: Object }) @IsObject() exceptions!: Record<string, boolean>; @ApiProperty({ type: Object }) @IsObject() severityDays!: Record<NcSeverity, number>; }
export class AuditWorkflowBindingDto { @ApiProperty({ format: 'uuid' }) @IsUUID() workflowDefinitionId!: string; @ApiProperty({ format: 'uuid' }) @IsUUID() workflowVersionId!: string; @ApiProperty() @IsString() @MaxLength(200) instanceKey!: string; }
export class CreateNcDto extends AuditScopeDto { @ApiProperty({ enum: ['MINOR','MAJOR','CRITICAL'] }) @IsIn(['MINOR','MAJOR','CRITICAL']) severity!: NcSeverity; @ApiPropertyOptional({ format: 'date-time', description: '可选；如提供，必须等于服务端按登记日历计算的期限' }) @IsOptional() @IsDateString() dueAt?: string; @ApiProperty({ description: '整改期限政策版本' }) @IsString() @MaxLength(100) duePolicyVersion!: string; @ApiProperty({ description: '工作日历版本' }) @IsString() @MaxLength(100) calendarVersion!: string; @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) dueBusinessDays!: number; @ApiProperty({ type: AuditWorkflowBindingDto }) @ValidateNested() @Type(() => AuditWorkflowBindingDto) workflowBinding!: AuditWorkflowBindingDto; }
export class AssignNcDto extends AuditScopeDto { @ApiProperty({ format: 'uuid' }) @IsUUID() assigneeUserId!: string; @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; }
export class RespondNcDto extends AuditScopeDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; @ApiProperty() @IsString() @MaxLength(10000) response!: string; }
export class VerifyNcDto extends AuditScopeDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; @ApiProperty() @IsBoolean() accepted!: boolean; }
export class CloseNcDto extends AuditScopeDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; }

export class AuditPlanResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organization_id!: string;
  @ApiProperty() year!: number;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ['SYSTEM','PROCESS','PRODUCT','SECOND_PARTY','CUSTOMER'] }) audit_type!: AuditType;
  @ApiProperty({ format: 'date-time' }) planned_start!: Date;
  @ApiProperty({ format: 'date-time' }) planned_end!: Date;
  @ApiProperty({ enum: ['PLANNED','APPROVED','IN_PROGRESS','COMPLETED','CANCELLED'] }) status!: string;
  @ApiProperty() version!: number;
}
export class AuditPostponementResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) plan_id!: string;
  @ApiProperty({ enum: ['PENDING','APPROVED','REJECTED'] }) status!: string;
  @ApiProperty() plan_version!: number;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) proposed_start!: Date;
  @ApiProperty({ format: 'date-time' }) proposed_end!: Date;
}
export class AuditTemplateResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['DRAFT','PUBLISHED'] }) status!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: Object }) draft_definition!: Record<string, unknown>;
}
export class PublishedAuditTemplateResponseDto extends AuditTemplateResponseDto {
  @ApiProperty({ format: 'uuid' }) versionId!: string;
  @ApiProperty() publishedVersion!: number;
}
export class AuditExecutionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) plan_id!: string;
  @ApiProperty({ format: 'uuid' }) template_version_id!: string;
  @ApiProperty({ enum: ['OPEN','SUBMITTED','COMPLETED','CANCELLED'] }) status!: string;
  @ApiProperty() version!: number;
}
export class AuditChecklistResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) execution_id!: string;
  @ApiProperty() item_key!: string;
  @ApiProperty({ enum: ['OK','NG','NA'] }) result!: ChecklistResult;
  @ApiPropertyOptional({ type: String, nullable: true }) note!: string | null;
  @ApiProperty() version!: number;
}
export class AuditNcResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) execution_id!: string;
  @ApiProperty({ format: 'uuid' }) checklist_result_id!: string;
  @ApiProperty({ enum: ['MINOR','MAJOR','CRITICAL'] }) severity!: NcSeverity;
  @ApiProperty({ enum: ['OPEN','ASSIGNED','RESPONDED','VERIFIED','REJECTED','CLOSED'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) due_at!: Date;
  @ApiPropertyOptional({ nullable: true }) due_policy_version!: string | null;
  @ApiPropertyOptional({ nullable: true }) calendar_version!: string | null;
  @ApiPropertyOptional({ nullable: true }) due_business_days!: number | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) assignee_user_id!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) response!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) verified_by_id!: string | null;
  @ApiProperty() version!: number;
}
export class AuditDeadlinePolicyResponseDto { @ApiProperty({ format: 'uuid' }) id!: string; @ApiProperty({ format: 'uuid' }) organization_id!: string; @ApiProperty() policy_version!: string; @ApiProperty() calendar_version!: string; @ApiProperty() time_zone!: string; @ApiProperty({ type: [Number] }) working_weekdays!: number[]; @ApiProperty({ type: Object }) exceptions!: Record<string, boolean>; @ApiProperty({ type: Object }) severity_days!: Record<NcSeverity, number>; @ApiProperty({ format: 'date-time' }) created_at!: Date; }
