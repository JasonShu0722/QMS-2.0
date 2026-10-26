import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import type { AnalysisSection, FaeAnalysisStatus } from './customer-complaint-analysis.types.js';

export class CustomerAnalysisScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}
export class AssignCustomerAnalysisDto extends CustomerAnalysisScopeDto {
  @ApiProperty({ minimum: 0, maximum: 2147483647, description: '0 for the first assignment; otherwise the analysis version.' }) @IsInt() @Min(0) @Max(2147483647) expectedVersion!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() assigneeUserId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() assigneeAssignmentId!: string;
}
export class TransferCustomerAnalysisDto extends AssignCustomerAnalysisDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) declare expectedVersion: number;
}
export class SaveCustomerAnalysisFilesDto extends CustomerAnalysisScopeDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 20 }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsUUID('all', { each: true }) fileIds?: string[];
}
export class SaveCustomerFaeAnalysisDto extends SaveCustomerAnalysisFilesDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 10000 }) @IsOptional() @IsString() @MaxLength(10000) text?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) completedOn?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) failedPart?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) failedMaterialCode?: string | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) @IsOptional() @IsBoolean() supplierAnalysisRequired?: boolean | null;
}
export class SaveCustomerSupplierAnalysisDto extends SaveCustomerAnalysisFilesDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 10000 }) @IsOptional() @IsString() @MaxLength(10000) progress?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 10000 }) @IsOptional() @IsString() @MaxLength(10000) result?: string | null;
}
export class CustomerAnalysisDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) complaintId!: string;
  @ApiProperty({ enum: ['FAE', 'SUPPLIER'] }) section!: AnalysisSection;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) assigneeUserId!: string;
  @ApiProperty({ format: 'uuid' }) assigneeAssignmentId!: string;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty({ type: String, nullable: true }) text!: string | null;
  @ApiProperty({ type: String, nullable: true }) progress!: string | null;
  @ApiProperty({ type: String, nullable: true }) result!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) completedOn!: string | null;
  @ApiProperty({ type: String, nullable: true }) failedPart!: string | null;
  @ApiProperty({ type: String, nullable: true }) failedMaterialCode!: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) supplierAnalysisRequired!: boolean | null;
  @ApiProperty({ type: [String], format: 'uuid' }) fileIds!: string[];
  @ApiProperty({ enum: ['NOT_ANALYSED', 'ANALYSED'], nullable: true }) faeStatus!: FaeAnalysisStatus | null;
  @ApiProperty({ format: 'uuid' }) updatedByUserId!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class CustomerAnalysisSummaryDto {
  @ApiProperty({ format: 'uuid' }) complaintId!: string;
  @ApiProperty({ type: CustomerAnalysisDto, nullable: true }) fae!: CustomerAnalysisDto | null;
  @ApiProperty({ type: CustomerAnalysisDto, nullable: true }) supplier!: CustomerAnalysisDto | null;
}
export class CustomerFaeAnalysisTaskDto {
  @ApiProperty({ enum: ['CUSTOMER_COMPLAINT_FAE'] }) kind!: 'CUSTOMER_COMPLAINT_FAE';
  @ApiProperty({ type: CustomerAnalysisDto }) analysis!: CustomerAnalysisDto;
}
export class CustomerAnalysisHistoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['ASSIGNED', 'TRANSFERRED', 'SAVED'] }) action!: string;
  @ApiProperty({ type: CustomerAnalysisDto }) snapshot!: CustomerAnalysisDto;
}
export class CustomerAnalysisCandidateDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ format: 'uuid' }) assignmentId!: string;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
}
