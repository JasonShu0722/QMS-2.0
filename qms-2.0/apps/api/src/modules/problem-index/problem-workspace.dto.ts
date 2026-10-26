import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { ProblemDomainSummaryDto, ProblemFieldDto, ProblemIndexResponseDto, ProblemScopeQueryDto } from './problem-index.dto.js';
import { TaskDto } from '../task-notification/task-inbox.dto.js';
import { FileEvidenceDto } from '../file-management/file.dto.js';
import { WORKFLOW_ACTIONS, WORKFLOW_NODE_TYPES } from '../workflow/workflow.types.js';

export class ProblemWorkspaceQueryDto extends ProblemScopeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() instanceId?: string;
}
export { ProblemFieldDto } from './problem-index.dto.js';
export class ProblemSectionDto {
  @ApiProperty() key!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: [ProblemFieldDto] }) fields!: ProblemFieldDto[];
}
export class ProblemDomainWorkspaceDto {
  @ApiProperty() domainVersion!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) revisionId!: string | null;
  @ApiProperty({ type: ProblemDomainSummaryDto }) summary!: ProblemDomainSummaryDto;
  @ApiProperty({ type: [ProblemSectionDto] }) sections!: ProblemSectionDto[];
}
export class ProblemInstanceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) workflowVersionId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'SUSPENDED'] }) status!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) currentNodeId!: string | null;
  @ApiProperty() current!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class ProblemNodeFactDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: WORKFLOW_NODE_TYPES }) type!: string;
  @ApiProperty() current!: boolean;
  @ApiProperty() visited!: boolean;
  @ApiProperty() actionCount!: number;
}
export class ProblemWorkflowActionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) nodeId!: string;
  @ApiProperty({ enum: ['START', ...WORKFLOW_ACTIONS] }) action!: string;
  @ApiProperty() instanceVersion!: number;
  @ApiProperty({ format: 'uuid' }) actorUserId!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class ProblemCapabilityDto {
  @ApiProperty() canAct!: boolean;
  @ApiProperty({ enum: WORKFLOW_ACTIONS, isArray: true }) allowedActions!: string[];
  @ApiProperty({ type: String, nullable: true }) reasonCode!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) currentNodeId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) taskId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) claimedByUserId!: string | null;
  @ApiProperty() projectionPending!: boolean;
}
export class ProblemActionDescriptionDto {
  @ApiProperty() actionKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: String, nullable: true }) reasonCode!: string | null;
}
export class ProblemUpgradeDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) beforeInstanceId!: string;
  @ApiProperty({ format: 'uuid' }) afterInstanceId!: string;
  @ApiProperty({ format: 'uuid' }) actorUserId!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'uuid' }) beforeDomainRevisionId!: string;
  @ApiProperty({ format: 'uuid' }) afterDomainRevisionId!: string;
  @ApiProperty() mappingVersion!: string;
}
export class ProblemWorkspaceDto {
  @ApiProperty({ type: ProblemIndexResponseDto }) problem!: ProblemIndexResponseDto;
  @ApiProperty({ type: ProblemInstanceDto, nullable: true }) selectedInstance!: ProblemInstanceDto | null;
  @ApiProperty({ type: [ProblemInstanceDto] }) instances!: ProblemInstanceDto[];
  @ApiProperty({ type: [ProblemUpgradeDto] }) upgrades!: ProblemUpgradeDto[];
  @ApiProperty({ type: ProblemDomainWorkspaceDto, nullable: true }) domain!: ProblemDomainWorkspaceDto | null;
  @ApiProperty({ enum: ['AVAILABLE', 'UNAVAILABLE'] }) domainAvailability!: 'AVAILABLE' | 'UNAVAILABLE';
  @ApiProperty() readOnly!: boolean;
  @ApiProperty({ type: [ProblemNodeFactDto] }) nodes!: ProblemNodeFactDto[];
  @ApiProperty({ type: [ProblemWorkflowActionDto] }) workflowActions!: ProblemWorkflowActionDto[];
  @ApiProperty({ type: ProblemCapabilityDto }) capabilities!: ProblemCapabilityDto;
  @ApiProperty({ type: TaskDto, nullable: true }) task!: TaskDto | null;
  @ApiProperty({ type: [ProblemActionDescriptionDto] }) actions!: ProblemActionDescriptionDto[];
  @ApiProperty({ type: [FileEvidenceDto] }) evidence!: FileEvidenceDto[];
}
