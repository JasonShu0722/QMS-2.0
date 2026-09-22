import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

export class WorkflowUpgradeScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  organizationId?: string;
}

export class WorkflowUpgradeRequestDto extends WorkflowUpgradeScopeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() instanceId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() currentNodeId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) expectedProblemVersion!: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) expectedInstanceVersion!: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) expectedDomainVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 1000 }) @IsString() @Length(1, 1000) @Matches(/\S/) reason!: string;
}

export class WorkflowMappingOutcomeDto {
  @ApiProperty() fieldId!: string;
  @ApiProperty({ enum: ['COPIED', 'PRESERVED', 'UNMAPPED'] }) outcome!: 'COPIED' | 'PRESERVED' | 'UNMAPPED';
}

export class WorkflowUpgradePreviewDto {
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty() canUpgrade!: boolean;
  @ApiProperty({ type: String, nullable: true }) reasonCode!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) instanceId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) currentNodeId!: string | null;
  @ApiProperty() expectedProblemVersion!: number;
  @ApiProperty({ type: Number, nullable: true }) expectedInstanceVersion!: number | null;
  @ApiProperty({ type: Number, nullable: true }) expectedDomainVersion!: number | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) targetVersionId!: string | null;
  @ApiProperty({ type: String, nullable: true }) targetProblemType!: string | null;
  @ApiProperty({ type: String, nullable: true }) mappingVersion!: string | null;
  @ApiProperty({ type: [WorkflowMappingOutcomeDto] }) mappingSummary!: WorkflowMappingOutcomeDto[];
}

export class WorkflowUpgradeResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty({ format: 'uuid' }) beforeInstanceId!: string;
  @ApiProperty({ format: 'uuid' }) afterInstanceId!: string;
  @ApiProperty({ format: 'uuid' }) workflowVersionId!: string;
  @ApiProperty({ format: 'uuid' }) currentNodeId!: string;
  @ApiProperty() problemVersion!: number;
  @ApiProperty() instanceVersion!: number;
  @ApiProperty() domainVersion!: number;
  @ApiProperty({ format: 'uuid' }) beforeDomainRevisionId!: string;
  @ApiProperty({ format: 'uuid' }) afterDomainRevisionId!: string;
  @ApiProperty() mappingVersion!: string;
  @ApiProperty({ type: [WorkflowMappingOutcomeDto] }) mappingSummary!: WorkflowMappingOutcomeDto[];
  @ApiProperty({ format: 'date-time' }) upgradedAt!: string;
}
