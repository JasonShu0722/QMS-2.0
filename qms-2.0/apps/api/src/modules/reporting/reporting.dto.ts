import { ApiProperty } from '@nestjs/swagger';
import { ProblemDomainSummaryDto } from '../problem-index/problem-index.dto.js';
import { ProblemInstanceDto, ProblemNodeFactDto, ProblemSectionDto, ProblemUpgradeDto, ProblemWorkflowActionDto } from '../problem-index/problem-workspace.dto.js';
import { FileEvidenceDto } from '../file-management/file.dto.js';

export class ProblemReportIdentityDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty() domainCode!: string;
  @ApiProperty() sourceType!: string;
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
}
export class ProblemReportRevisionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() instanceVersion!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
export class ProblemReportSnapshotDto {
  @ApiProperty({ type: String, nullable: true }) problemType!: string | null;
  @ApiProperty({ type: String, nullable: true }) severity!: string | null;
  @ApiProperty({ type: String, nullable: true }) status!: string | null;
  @ApiProperty({ type: String, nullable: true }) responsibleParty!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) ownerId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) dueAt!: string | null;
}
export class ProblemReportDto {
  @ApiProperty({ format: 'date-time' }) generatedAt!: string;
  @ApiProperty({ type: ProblemReportIdentityDto }) problem!: ProblemReportIdentityDto;
  @ApiProperty({ type: ProblemInstanceDto, nullable: true }) instance!: ProblemInstanceDto | null;
  @ApiProperty({ type: ProblemReportRevisionDto, nullable: true }) revision!: ProblemReportRevisionDto | null;
  @ApiProperty({ type: ProblemDomainSummaryDto, nullable: true }) summary!: ProblemDomainSummaryDto | null;
  @ApiProperty({ type: ProblemReportSnapshotDto, nullable: true }) snapshot!: ProblemReportSnapshotDto | null;
  @ApiProperty({ type: [ProblemSectionDto] }) sections!: ProblemSectionDto[];
  @ApiProperty({ type: [ProblemNodeFactDto] }) nodes!: ProblemNodeFactDto[];
  @ApiProperty({ type: [ProblemWorkflowActionDto] }) workflowActions!: ProblemWorkflowActionDto[];
  @ApiProperty({ type: [FileEvidenceDto] }) evidence!: FileEvidenceDto[];
  @ApiProperty({ type: [ProblemUpgradeDto] }) upgrades!: ProblemUpgradeDto[];
  @ApiProperty({ enum: ['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'] }) dataAvailability!: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  @ApiProperty({ type: [String] }) unavailableFields!: string[];
}
