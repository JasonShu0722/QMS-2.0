import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { TrialMetricCode } from './new-product-quality.service.js';

export class NewProductScopeDto { @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string; }
export class CreateNewProductProjectDto extends NewProductScopeDto {
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) code!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) name!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) productCode!: string;
}
export class CreateNewProductStageDto extends NewProductScopeDto {
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) code!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) name!: string;
}
export class CreateNewProductDeliverableDto extends CreateNewProductStageDto {
  @ApiProperty() @IsBoolean() required!: boolean;
}
export class SubmitNewProductDeliverableDto extends NewProductScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() evidenceObjectId!: string;
}
export class CreateNewProductLessonDto extends NewProductScopeDto {
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) title!: string;
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) lesson!: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) productCode?: string;
}
export class ConfirmNewProductLessonDto extends SubmitNewProductDeliverableDto {
  @ApiProperty() @IsBoolean() avoided!: boolean;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
export class ReviewNewProductStageDto extends NewProductScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ enum: ['PASS', 'REJECT'] }) @IsIn(['PASS', 'REJECT']) decision!: 'PASS' | 'REJECT';
}
export class CreateNewProductTrialBatchDto extends NewProductScopeDto {
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) code!: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) workOrderCode?: string;
}
export class RecordNewProductMetricDto extends NewProductScopeDto {
  @ApiProperty({ enum: ['INPUT', 'OUTPUT', 'FIRST_PASS', 'DEFECT', 'CPK', 'DIMENSION_PASS_RATE'] }) @IsIn(['INPUT', 'OUTPUT', 'FIRST_PASS', 'DEFECT', 'CPK', 'DIMENSION_PASS_RATE']) code!: TrialMetricCode;
  @ApiProperty({ minimum: 0 }) @IsNumber() @Min(0) target!: number;
  @ApiProperty({ minimum: 0 }) @IsNumber() @Min(0) actual!: number;
  @ApiProperty({ enum: ['GTE', 'LTE'] }) @IsIn(['GTE', 'LTE']) comparison!: 'GTE' | 'LTE';
  @ApiProperty({ enum: ['MANUAL'] }) @IsIn(['MANUAL']) source!: 'MANUAL';
}
export class NewProductProjectDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organization_id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() product_code!: string;
  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] }) status!: string;
  @ApiProperty() version!: number;
}
export class NewProductStageDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) project_id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['OPEN', 'PASSED', 'REJECTED'] }) status!: string;
  @ApiProperty() version!: number;
}
export class NewProductDeliverableDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) stage_id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() required!: boolean;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) evidence_object_id!: string | null;
  @ApiProperty() version!: number;
}
export class NewProductLessonDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() lesson!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) product_code!: string | null;
  @ApiProperty({ enum: ['MANUAL'] }) source_kind!: string;
}
export class NewProductLessonCheckDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) project_id!: string;
  @ApiProperty({ format: 'uuid' }) lesson_id!: string;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) avoided!: boolean | null;
  @ApiPropertyOptional({ type: String, nullable: true }) reason!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) evidence_object_id!: string | null;
  @ApiProperty() version!: number;
}
export class NewProductTrialBatchDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) project_id!: string;
  @ApiProperty() code!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) work_order_code!: string | null;
  @ApiProperty() version!: number;
}
export class NewProductTrialMetricDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) batch_id!: string;
  @ApiProperty({ enum: ['INPUT', 'OUTPUT', 'FIRST_PASS', 'DEFECT', 'CPK', 'DIMENSION_PASS_RATE'] }) code!: string;
  @ApiProperty() target!: number;
  @ApiProperty() actual!: number;
  @ApiProperty({ enum: ['GTE', 'LTE'] }) comparison!: string;
  @ApiProperty({ enum: ['MANUAL'] }) source!: string;
  @ApiPropertyOptional({ enum: ['GREEN', 'RED'] }) signal?: string;
}
export class NewProductProjectDetailDto extends NewProductProjectDto {
  @ApiProperty({ type: [NewProductStageDto] }) stages!: NewProductStageDto[];
  @ApiProperty({ type: [NewProductLessonCheckDto] }) lessons!: NewProductLessonCheckDto[];
  @ApiProperty({ type: [NewProductTrialBatchDto] }) batches!: NewProductTrialBatchDto[];
  @ApiProperty({ type: [Object] }) selected_defects!: Record<string, unknown>[];
  @ApiPropertyOptional({ type: () => NewProductHandoverDto, nullable: true }) handover!: NewProductHandoverDto | null;
  @ApiPropertyOptional({ type: () => NewProductEarlyFlowDto, nullable: true }) early_flow!: NewProductEarlyFlowDto | null;
  @ApiPropertyOptional({ type: Object }) issues!: Record<string, unknown>;
}
export class HandoverNewProductProjectDto extends NewProductScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) riskStatement!: string;
}
export class NewProductHandoverDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) project_id!: string;
  @ApiProperty() project_version!: number;
  @ApiProperty() risk_statement!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) mass_production_approval_id!: string | null;
  @ApiProperty({ type: [Object] }) stage_snapshot!: Record<string, unknown>[];
  @ApiProperty({ type: [Object] }) trial_snapshot!: Record<string, unknown>[];
  @ApiProperty() open_issue_count!: number;
  @ApiProperty({ format: 'uuid' }) handed_over_by_id!: string;
  @ApiProperty() handed_over_at!: Date;
}
export class NewProductTrialReportDto extends NewProductTrialBatchDto {
  @ApiProperty({ type: [NewProductTrialMetricDto] }) metrics!: NewProductTrialMetricDto[];
}
export class CreateNewProductTrialSummaryDto extends NewProductScopeDto {
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) conclusion!: string;
}
export class SubmitNewProductTrialSummaryDto extends NewProductScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}
export class ReviseNewProductTrialSummaryDto extends SubmitNewProductTrialSummaryDto {
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) conclusion!: string;
}
export class DecideNewProductTrialSummaryDto extends SubmitNewProductTrialSummaryDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class NewProductTrialSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) batchId!: string;
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiProperty() conclusion!: string;
  @ApiProperty({ enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] }) status!: string;
  @ApiProperty({ type: [Object] }) metricSnapshot!: Record<string, unknown>[];
  @ApiProperty({ type: [Object] }) issueSnapshot!: Record<string, unknown>[];
  @ApiPropertyOptional({ type: String, nullable: true }) sourceSha256!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) createdById!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) submittedById!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) submittedAt!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) approvedById!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) approvedAt!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) approvalNote!: string | null;
}
export class NewProductTrialSummaryRevisionDto {
  @ApiProperty() revision!: number;
  @ApiProperty() conclusion!: string;
  @ApiProperty({ type: [Object] }) metricSnapshot!: Record<string, unknown>[];
  @ApiProperty({ type: [Object] }) issueSnapshot!: Record<string, unknown>[];
  @ApiProperty() sourceSha256!: string;
  @ApiProperty({ format: 'uuid' }) submittedById!: string;
  @ApiProperty({ format: 'date-time' }) submittedAt!: string;
  @ApiPropertyOptional({ enum: ['APPROVE', 'REJECT'], nullable: true }) decision!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) decidedById!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) decidedAt!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) decisionNote!: string | null;
}
export class CreateNewProductEarlyFlowDto extends NewProductScopeDto {
  @ApiProperty({ minimum: 1, maximum: 365 }) @IsInt() @Min(1) @Max(365) monitoringWindowDays!: number;
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) monitoringFrequency!: string;
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) plan!: string;
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) exitCriteria!: string;
}
export class ReviseNewProductEarlyFlowDto extends CreateNewProductEarlyFlowDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}
export class SubmitNewProductEarlyFlowDto extends NewProductScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}
export class ApproveNewProductEarlyFlowDto extends SubmitNewProductEarlyFlowDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class DecideNewProductEarlyFlowReleaseDto extends NewProductScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @ApiProperty({ format: 'uuid' }) @IsUUID() evidenceObjectId!: string;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class NewProductEarlyFlowReleaseDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) decision!: 'APPROVE' | 'REJECT';
  @ApiPropertyOptional({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ format: 'uuid' }) evidenceObjectId!: string;
  @ApiProperty({ format: 'uuid' }) decidedById!: string;
  @ApiProperty({ format: 'date-time' }) decidedAt!: string;
  @ApiProperty() flowVersion!: number;
}
export class NewProductEarlyFlowDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiProperty() monitoringWindowDays!: number;
  @ApiProperty() monitoringFrequency!: string;
  @ApiProperty() plan!: string;
  @ApiProperty() exitCriteria!: string;
  @ApiProperty({ enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] }) status!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) approvalNote!: string | null;
  @ApiPropertyOptional({ type: NewProductEarlyFlowReleaseDto, nullable: true }) releaseDecision!: NewProductEarlyFlowReleaseDto | null;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) submittedById!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) submittedAt!: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) approvedById!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) approvedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class SelectNewProductDefectDto extends NewProductScopeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() defectId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
export class NewProductWorkflowBindingDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() workflowDefinitionId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() workflowVersionId!: string;
  @ApiProperty({ minLength: 1, maxLength: 128 }) @IsString() @MaxLength(128) instanceKey!: string;
}
export class IssueNewProductDefectsDto extends NewProductScopeDto {
  @ApiProperty({ type: [String], minItems: 1 }) @IsArray() @ArrayMinSize(1) @IsUUID(undefined, { each: true }) selectionIds!: string[];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() trialBatchId?: string;
  @ApiProperty({ maxLength: 64 }) @IsString() @MaxLength(64) severity!: string;
  @ApiProperty({ enum: ['SIMPLE', 'COMPLEX'] }) @IsIn(['SIMPLE', 'COMPLEX']) complexity!: 'SIMPLE' | 'COMPLEX';
  @ApiProperty({ type: NewProductWorkflowBindingDto }) @ValidateNested() @Type(() => NewProductWorkflowBindingDto) workflowBinding!: NewProductWorkflowBindingDto;
}
export class EscalateNewProductIssueDto extends NewProductScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}
export class AssignNewProductIssueDto extends NewProductScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() assigneeUserId!: string;
}
export class RecordNewProductMeasureDto extends NewProductScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) measurePlan!: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsISO8601() measureDueAt?: string;
}
export class VerifyNewProductIssueDto extends NewProductScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) verificationSummary!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() evidenceObjectId?: string;
}
export class CloseNewProductIssueDto extends NewProductScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ maxLength: 2000 }) @IsString() @MaxLength(2000) closureNote!: string;
}
export class NewProductIssueDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) project_id!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) trial_batch_id!: string | null;
  @ApiProperty({ enum: ['BRIEF', 'EIGHT_D'] }) response_form!: string;
  @ApiProperty({ enum: ['SIMPLE', 'COMPLEX'] }) complexity!: string;
  @ApiProperty() severity!: string;
  @ApiProperty({ enum: ['OPEN', 'ESCALATED', 'IN_PROGRESS', 'VERIFIED', 'CLOSED'] }) status!: string;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) owner_user_id!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) owner_username!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) measure_plan!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) measure_due_at!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) verification_summary!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) verification_evidence_object_id!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) verified_by_id!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) verified_at!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) closed_at!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) closure_note!: string | null;
}
export class NewProductIssueStatsDto {
  @ApiProperty() total!: number;
  @ApiProperty() open!: number;
  @ApiProperty() escalated!: number;
  @ApiProperty() in_progress!: number;
  @ApiProperty() verified!: number;
  @ApiProperty() closed!: number;
}
export class NewProductIssueListDto {
  @ApiProperty({ type: [NewProductIssueDto] }) items!: NewProductIssueDto[];
  @ApiProperty({ type: NewProductIssueStatsDto }) stats!: NewProductIssueStatsDto;
}
export class CreateNewProductLegacyIssueDto extends NewProductScopeDto {
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) description!: string;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }) @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) riskLevel!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}
export class ApproveNewProductMassProductionDto extends NewProductScopeDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) riskStatement!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() evidenceObjectId!: string;
}
