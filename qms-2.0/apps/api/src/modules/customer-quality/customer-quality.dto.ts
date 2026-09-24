import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';

export class CustomerScopeDto { @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string; }
export class CreateCustomerDto extends CustomerScopeDto { @ApiProperty() @IsString() @MaxLength(100) code!: string; @ApiProperty() @IsString() @MaxLength(200) name!: string; }
export class UpdateCustomerDto extends CustomerScopeDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string; @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean; }
export class CreateComplaintDto extends CustomerScopeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() customerId!: string;
  @ApiProperty({ enum: ['ZERO_KM', 'AFTER_SALES'] }) @IsIn(['ZERO_KM', 'AFTER_SALES']) complaintType!: 'ZERO_KM' | 'AFTER_SALES';
  @ApiProperty() @IsString() @MaxLength(10000) defectDescription!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) terminalCustomerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) productCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) productModel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) vin?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) mileage?: number;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() purchaseDate?: Date;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() returnRequired?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() physicalAnalysisRequired?: boolean;
  @ApiProperty() @IsString() @MaxLength(32) severity!: string;
  @ApiProperty() @IsString() @MaxLength(100) severityPolicyVersion!: string;
  @ApiProperty({ type: Object }) severitySnapshot!: Prisma.InputJsonValue;
  @ApiPropertyOptional({ enum: ['ERP', 'SAP', 'IMS'] }) @IsOptional() @IsIn(['ERP', 'SAP', 'IMS']) externalSourceSystem?: 'ERP' | 'SAP' | 'IMS';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) externalRecordKey?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() sourceObservedAt?: Date;
}
export class UpdateComplaintDto extends CustomerScopeDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) defectDescription?: string; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) severity?: string; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) severityPolicyVersion?: string; @ApiPropertyOptional({ type: Object }) @IsOptional() severitySnapshot?: Prisma.InputJsonValue; }
export class ArchiveComplaintDto extends CustomerScopeDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; }
export class PhysicalDispositionDto extends CustomerScopeDto { @ApiProperty({ enum: ['RETURN', 'REPAIR', 'SCRAP', 'NO_RETURN', 'OTHER'] }) @IsIn(['RETURN', 'REPAIR', 'SCRAP', 'NO_RETURN', 'OTHER']) action!: string; @ApiProperty({ enum: ['PENDING', 'RECEIVED', 'REPAIRED', 'SCRAPPED', 'CLOSED'] }) @IsIn(['PENDING', 'RECEIVED', 'REPAIRED', 'SCRAPPED', 'CLOSED']) status!: string; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) responsibility?: string; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) notes?: string; }
export class PhysicalAnalysisDto extends CustomerScopeDto { @ApiProperty() @IsString() @MaxLength(10000) summary!: string; @ApiProperty({ enum: ['MISSING', 'IN_PROGRESS', 'COMPLETED'] }) @IsIn(['MISSING', 'IN_PROGRESS', 'COMPLETED']) status!: string; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) evidenceSummary?: string; }

export class CustomerMasterDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organization_id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty() version!: number;
}

export class CustomerPhysicalDispositionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) complaint_id!: string;
  @ApiProperty({ enum: ['RETURN', 'REPAIR', 'SCRAP', 'NO_RETURN', 'OTHER'] }) action!: string;
  @ApiProperty({ enum: ['PENDING', 'RECEIVED', 'REPAIRED', 'SCRAPPED', 'CLOSED'] }) status!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) responsibility!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) created_at!: string;
}

export class CustomerPhysicalAnalysisDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) complaint_id!: string;
  @ApiProperty() summary!: string;
  @ApiProperty({ enum: ['MISSING', 'IN_PROGRESS', 'COMPLETED'] }) status!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) evidence_summary!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) created_at!: string;
}

export class CustomerComplaintDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organization_id!: string;
  @ApiProperty() complaint_number!: string;
  @ApiProperty({ format: 'uuid' }) customer_id!: string;
  @ApiProperty({ enum: ['ZERO_KM', 'AFTER_SALES'] }) complaint_type!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) terminal_customer_name!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) product_code!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) product_model!: string | null;
  @ApiProperty() defect_description!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) vin!: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) mileage!: number | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) purchase_date!: string | null;
  @ApiProperty() return_required!: boolean;
  @ApiProperty() physical_analysis_required!: boolean;
  @ApiProperty() severity!: string;
  @ApiProperty() severity_policy_version!: string;
  @ApiProperty({ type: Object }) severity_snapshot!: Record<string, unknown>;
  @ApiProperty({ enum: ['OPEN', 'IN_ANALYSIS', 'RESOLVED', 'ARCHIVED'] }) status!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) external_source_system!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) external_record_key!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) source_observed_at!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) ingestion_status!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) problem_index_id!: string | null;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) archived_at!: string | null;
  @ApiProperty({ format: 'date-time' }) created_at!: string;
}

export class CustomerComplaintDetailDto extends CustomerComplaintDto {
  @ApiPropertyOptional({ type: CustomerPhysicalDispositionDto, nullable: true }) currentDisposition!: CustomerPhysicalDispositionDto | null;
  @ApiPropertyOptional({ type: CustomerPhysicalAnalysisDto, nullable: true }) currentAnalysis!: CustomerPhysicalAnalysisDto | null;
}

export class CustomerIssueSourceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() complaintId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class CustomerIssueWorkflowBindingDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() workflowDefinitionId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() workflowVersionId!: string;
  @ApiProperty({ maxLength: 128 }) @IsString() @MaxLength(128) instanceKey!: string;
}

export class IssueCustomerComplaintsDto extends CustomerScopeDto {
  @ApiProperty({ type: [CustomerIssueSourceDto], minItems: 1, maxItems: 100 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CustomerIssueSourceDto) sources!: CustomerIssueSourceDto[];
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) problemType!: string;
  @ApiProperty({ enum: ['BRIEF', 'EIGHT_D'] }) @IsIn(['BRIEF', 'EIGHT_D']) responseForm!: 'BRIEF' | 'EIGHT_D';
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) responsibleScope!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() dueAt?: Date;
  @ApiProperty({ type: CustomerIssueWorkflowBindingDto }) @ValidateNested() @Type(() => CustomerIssueWorkflowBindingDto) workflowBinding!: CustomerIssueWorkflowBindingDto;
}

export class CustomerIssueProblemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty({ format: 'uuid' }) workflowInstanceId!: string;
  @ApiProperty() version!: number;
}

export class CustomerIssueResultDto {
  @ApiProperty({ type: CustomerIssueProblemDto }) problem!: CustomerIssueProblemDto;
  @ApiProperty() replayed!: boolean;
}

export class ChangeCustomerIssueSourcesDto extends CustomerScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedProblemVersion!: number;
  @ApiProperty({ type: [CustomerIssueSourceDto] }) @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CustomerIssueSourceDto) add!: CustomerIssueSourceDto[];
  @ApiProperty({ type: [String], format: 'uuid' }) @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) remove!: string[];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() primaryComplaintId?: string;
}

export class CustomerIssueLinkHistoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) problemIndexId!: string;
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
  @ApiProperty({ enum: ['LINKED', 'UNLINKED', 'PRIMARY_SELECTED'] }) action!: string;
  @ApiProperty() sourceVersion!: number;
  @ApiProperty({ type: Object }) sourceSnapshot!: Record<string, unknown>;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) actorUserId!: string | null;
  @ApiProperty({ format: 'date-time' }) changedAt!: string;
}
