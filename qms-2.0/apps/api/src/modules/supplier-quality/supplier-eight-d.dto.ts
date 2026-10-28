import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { ProcessEightDDocumentDto } from '../process-quality/process-eight-d-document.dto.js';
import { WorkflowClosureRoundDto } from '../workflow/workflow-closure-round.dto.js';

export class IssueSupplierEightDDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() sqeAssignmentId!: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() analysisDueAt?: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() closureDueAt?: Date;
}
export class SupplierEightDVersionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) expectedRowVersion!: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) expectedInstanceVersion!: number;
}
export class SaveSupplierEightDDto extends SupplierEightDVersionDto {
  @ApiProperty({ type: ProcessEightDDocumentDto }) @ValidateNested() @Type(() => ProcessEightDDocumentDto) document!: ProcessEightDDocumentDto;
}
export class SupplierEightDAnalysisCompleteDto extends SupplierEightDVersionDto {
  @ApiProperty({ type: String, format: 'date-time' }) @Type(() => Date) @IsDate() submissionDueAt!: Date;
}
export class SupplierEightDDeadlinesDto extends SupplierEightDVersionDto {
  @ApiPropertyOptional({ type: String, format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() analysisDueAt?: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() closureDueAt?: Date;
}
export class SupplierEightDReportDto {
  @ApiProperty({ format: 'uuid' }) supplierProblemId!: string;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) instanceId!: string;
  @ApiProperty({ format: 'uuid' }) workflowVersionId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty() title!: string;
  @ApiProperty() severity!: string;
  @ApiProperty() status!: string;
  @ApiProperty() rowVersion!: number;
  @ApiProperty() contentVersion!: number;
  @ApiProperty() instanceVersion!: number;
  @ApiProperty({ format: 'uuid' }) sqeUserId!: string;
  @ApiProperty({ format: 'uuid' }) sqeAssignmentId!: string;
  @ApiProperty({ format: 'uuid' }) responsibleSectionDepartmentId!: string;
  @ApiProperty({ type: ProcessEightDDocumentDto }) document!: ProcessEightDDocumentDto;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) submittedRevisionId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) approvedRevisionId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) analysisDueAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) analysisCompletedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) submissionDueAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) submittedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closureDueAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) releasedToSupplierAt!: string | null;
  @ApiProperty({ type: [String] }) allowedActions!: string[];
  @ApiProperty({ type: WorkflowClosureRoundDto, nullable: true }) closure!: WorkflowClosureRoundDto | null;
}
