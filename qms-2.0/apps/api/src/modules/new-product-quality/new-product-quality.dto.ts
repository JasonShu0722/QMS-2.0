import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
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
}
export class NewProductTrialReportDto extends NewProductTrialBatchDto {
  @ApiProperty({ type: [NewProductTrialMetricDto] }) metrics!: NewProductTrialMetricDto[];
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
export class CreateNewProductLegacyIssueDto extends NewProductScopeDto {
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) description!: string;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }) @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) riskLevel!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}
export class ApproveNewProductMassProductionDto extends NewProductScopeDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) riskStatement!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() evidenceObjectId!: string;
}
