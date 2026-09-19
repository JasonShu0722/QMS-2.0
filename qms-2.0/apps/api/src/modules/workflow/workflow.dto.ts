import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { WORKFLOW_NODE_TYPES, WORKFLOW_VERSION_STATUSES, type WorkflowNodeType, type WorkflowVersionStatus } from './workflow.types.js';

export class WorkflowNodeDraftDto {
  @ApiProperty() @IsString() @MaxLength(100) id!: string;
  @ApiProperty({ enum: WORKFLOW_NODE_TYPES, enumName: 'WorkflowNodeType' }) @IsIn(WORKFLOW_NODE_TYPES) type!: WorkflowNodeType;
  @ApiProperty() @IsString() @MaxLength(200) name!: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() config?: Record<string, unknown>;
}

export class WorkflowTransitionDraftDto {
  @ApiProperty() @IsString() @MaxLength(100) id!: string;
  @ApiProperty() @IsString() from!: string;
  @ApiProperty() @IsString() to!: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() condition?: Record<string, unknown>;
}

export class WorkflowGraphDto {
  @ApiProperty({ type: [WorkflowNodeDraftDto], minItems: 1 }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => WorkflowNodeDraftDto) nodes!: WorkflowNodeDraftDto[];
  @ApiProperty({ type: [WorkflowTransitionDraftDto], minItems: 1 }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => WorkflowTransitionDraftDto) transitions!: WorkflowTransitionDraftDto[];
}

export class CreateWorkflowDto extends WorkflowGraphDto {
  @ApiProperty() @IsString() @MaxLength(100) code!: string;
  @ApiProperty() @IsString() @MaxLength(200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class UpdateWorkflowDraftDto extends WorkflowGraphDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class PublishWorkflowDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) changeNote?: string;
}

export class CopyWorkflowDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() sourceVersionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class WorkflowVersionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() workflowDefinitionId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: WORKFLOW_VERSION_STATUSES, enumName: 'WorkflowVersionStatus' }) status!: WorkflowVersionStatus;
  @ApiPropertyOptional() publishedAt?: string;
  @ApiPropertyOptional() publishedById?: string;
  @ApiPropertyOptional() changeNote?: string;
  @ApiProperty({ type: Object }) structureSnapshot!: Record<string, unknown>;
}

export class WorkflowDefinitionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ type: WorkflowVersionResponseDto }) version!: WorkflowVersionResponseDto;
}

export class WorkflowValidationResponseDto {
  @ApiProperty() valid!: boolean;
  @ApiProperty({ type: [String] }) errors!: string[];
}
