import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class WorkflowNodeDraftDto {
  @ApiProperty() @IsString() @MaxLength(100) id!: string;
  @ApiProperty({ enum: ['ACTION', 'APPROVAL', 'VERIFICATION', 'CC', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE'] }) @IsString() type!: string;
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
  @ApiProperty({ type: [WorkflowNodeDraftDto] }) @IsArray() nodes!: WorkflowNodeDraftDto[];
  @ApiProperty({ type: [WorkflowTransitionDraftDto] }) @IsArray() transitions!: WorkflowTransitionDraftDto[];
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
  @ApiProperty() status!: string;
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
  @ApiProperty({ type: WorkflowVersionResponseDto }) draft!: WorkflowVersionResponseDto;
}

export class WorkflowValidationResponseDto {
  @ApiProperty() valid!: boolean;
  @ApiProperty({ type: [String] }) errors!: string[];
}
