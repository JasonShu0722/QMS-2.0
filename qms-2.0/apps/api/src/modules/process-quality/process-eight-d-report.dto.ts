import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsUUID, ValidateIf } from 'class-validator';
import { ProcessEightDDocumentDto } from './process-eight-d-document.dto.js';

export class ProcessEightDReportQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_object, value) => value !== undefined) @IsUUID()
  organizationId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: '指定不可变修订；指定时不允许同时选择 CURRENT' })
  @ValidateIf((_object, value) => value !== undefined) @IsUUID()
  revisionId?: string;
  @ApiPropertyOptional({ enum: ['CURRENT', 'APPROVED'], default: 'CURRENT' })
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['CURRENT', 'APPROVED'])
  view?: 'CURRENT' | 'APPROVED';
}

export class ProcessEightDReportSourceDto {
  @ApiProperty() sourceDomain!: string;
  @ApiProperty() sourceType!: string;
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
  @ApiProperty() sourceVersion!: number;
  @ApiProperty({ type: Object, additionalProperties: true }) sourceSnapshot!: Record<string, unknown>;
}

export class ProcessEightDReportSnapshotDto {
  [key: string]: unknown;
  @ApiProperty({ type: ProcessEightDDocumentDto }) document!: ProcessEightDDocumentDto;
  @ApiProperty({ type: [ProcessEightDReportSourceDto] }) sources!: ProcessEightDReportSourceDto[];
  @ApiProperty({ type: Object, additionalProperties: true }) problem!: Record<string, unknown>;
  @ApiProperty({ type: Object, additionalProperties: true }) instance!: Record<string, unknown>;
  @ApiProperty({ type: Object, additionalProperties: { type: 'string', nullable: true } }) deadlines!: Record<string, string | null>;
  @ApiProperty() contentVersion!: number;
  @ApiProperty() rowVersion!: number;
  @ApiProperty({ type: String, nullable: true }) ownerUserId!: string | null;
  @ApiProperty({ format: 'uuid' }) professionalUserId!: string;
  @ApiProperty({ format: 'uuid' }) responsibleSectionDepartmentId!: string;
  @ApiProperty({ type: [String] }) collaboratorUserIds!: string[];
  @ApiProperty({ type: String, nullable: true }) analysisCompletedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) submittedAt!: string | null;
  @ApiPropertyOptional({ type: Object, additionalProperties: true }) approval?: Record<string, unknown>;
  @ApiPropertyOptional({ type: 'array', items: { type: 'object', additionalProperties: true } }) approvalRounds?: Record<string, unknown>[];
}

export class ProcessEightDReportAttachmentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() originalName!: string;
  @ApiProperty() contentType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty() sha256!: string;
  @ApiProperty() objectVersionId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: [String] }) uses!: string[];
  @ApiProperty({ enum: ['EMBEDDED', 'LISTED'] }) rendering!: 'EMBEDDED' | 'LISTED';
  @ApiProperty() note!: string;
}

export class ProcessEightDControlledReportDto {
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty({ enum: ['CURRENT', 'APPROVED', 'HISTORICAL'] }) view!: 'CURRENT' | 'APPROVED' | 'HISTORICAL';
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) revisionId!: string | null;
  @ApiProperty({ enum: ['DRAFT', 'IN_REVIEW', 'CLOSED_SUPPLEMENT', 'APPROVED', 'HISTORICAL'] })
  status!: 'DRAFT' | 'IN_REVIEW' | 'CLOSED_SUPPLEMENT' | 'APPROVED' | 'HISTORICAL';
  @ApiProperty() label!: string;
  @ApiProperty() contentVersion!: number;
  @ApiProperty() rowVersion!: number;
  @ApiProperty({ format: 'date-time' }) generatedAt!: string;
  @ApiProperty({ type: ProcessEightDReportSnapshotDto }) snapshot!: ProcessEightDReportSnapshotDto;
  @ApiProperty({ type: [ProcessEightDReportAttachmentDto] }) attachments!: ProcessEightDReportAttachmentDto[];
}
