import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, Validate, ValidateIf, ValidateNested, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';
import { MAX_WORKFLOW_NODES, MAX_WORKFLOW_SLA_MINUTES, MAX_WORKFLOW_TRANSITIONS, WORKFLOW_ACTIONS, WORKFLOW_CONDITION_FIELDS, WORKFLOW_CONDITION_OPERATORS, WORKFLOW_EDITABLE_NODE_TYPES, WORKFLOW_NODE_TYPES, WORKFLOW_VERSION_STATUSES, type WorkflowAction, type WorkflowNodeType, type WorkflowVersionStatus } from './workflow.types.js';

export class WorkflowAssignmentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/\S/) @MaxLength(100) roleCode?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() assigneeUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/\S/) @MaxLength(100) permission?: string;
}

export class WorkflowReminderDto {
  @ApiProperty({ minimum: 0, maximum: MAX_WORKFLOW_SLA_MINUTES }) @IsInt() @Min(0) @Max(MAX_WORKFLOW_SLA_MINUTES) offsetMinutes!: number;
}

export class WorkflowEditorPositionDto {
  @ApiProperty({ minimum: -100000, maximum: 100000 }) @IsNumber() @Min(-100000) @Max(100000) x!: number;
  @ApiProperty({ minimum: -100000, maximum: 100000 }) @IsNumber() @Min(-100000) @Max(100000) y!: number;
}

export class WorkflowClosureReviewDto {
  @ApiProperty({ enum: [1] }) @IsIn([1]) schemaVersion!: 1;
  @ApiProperty({ enum: ['INTERNAL', 'SUPPLIER'] }) @IsIn(['INTERNAL', 'SUPPLIER']) policy!: 'INTERNAL' | 'SUPPLIER';
  @ApiProperty({ maxLength: 100 }) @IsString() @Matches(/^\S(?:.*\S)?$/) @MaxLength(100) domainCode!: string;
}

export class WorkflowProcessEightDDto {
  @ApiProperty({ enum: [1] }) @IsIn([1]) schemaVersion!: 1;
  @ApiProperty({ enum: ['LEADER_THEN_PROFESSIONAL'] }) @IsIn(['LEADER_THEN_PROFESSIONAL']) extensionPolicy!: 'LEADER_THEN_PROFESSIONAL';
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 8760 }) @ValidateIf((_object, value) => value !== null) @IsInt() @Min(1) @Max(8760) reminderEveryHours!: number | null;
}

export class WorkflowSupplierEightDDto {
  @ApiProperty({ enum: [1] }) @IsIn([1]) schemaVersion!: 1;
  @ApiProperty({ type: Number, nullable: true, enum: [null] }) @IsIn([null]) reminderEveryHours!: null;
}

export class WorkflowNodeConfigDto {
  // Preserve absent markers through class transformation; a declared marker is fail-closed.
  @ApiPropertyOptional({ type: WorkflowSupplierEightDDto }) @ValidateIf((_object, value) => value !== undefined) @IsObject() @ValidateNested() @Type(() => WorkflowSupplierEightDDto) declare supplierEightD?: WorkflowSupplierEightDDto;
  @ApiPropertyOptional({ type: WorkflowProcessEightDDto }) @ValidateIf((_object, value) => value !== undefined) @IsObject() @ValidateNested() @Type(() => WorkflowProcessEightDDto) processEightD?: WorkflowProcessEightDDto;
  @ApiPropertyOptional({ type: WorkflowClosureReviewDto }) @ValidateIf((_object, value) => value !== undefined) @IsObject() @ValidateNested() @Type(() => WorkflowClosureReviewDto) closureReview?: WorkflowClosureReviewDto;
  @ApiPropertyOptional({ type: WorkflowAssignmentDto }) @IsOptional() @ValidateNested() @Type(() => WorkflowAssignmentDto) assignment?: WorkflowAssignmentDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isStart?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isEnd?: boolean;
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_WORKFLOW_SLA_MINUTES }) @IsOptional() @IsInt() @Min(1) @Max(MAX_WORKFLOW_SLA_MINUTES) slaMinutes?: number;
  @ApiPropertyOptional({ type: [WorkflowReminderDto], maxItems: 20 }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => WorkflowReminderDto) reminders?: WorkflowReminderDto[];
  @ApiPropertyOptional({ type: WorkflowAssignmentDto }) @IsOptional() @ValidateNested() @Type(() => WorkflowAssignmentDto) escalation?: WorkflowAssignmentDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireIndependentVerification?: boolean;
  @ApiPropertyOptional({ type: WorkflowEditorPositionDto }) @IsOptional() @ValidateNested() @Type(() => WorkflowEditorPositionDto) editorPosition?: WorkflowEditorPositionDto;
}

@ValidatorConstraint({ name: 'workflowConditionValue', async: false })
class WorkflowConditionValueConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    const scalar = (entry: unknown) => entry === null || (typeof entry === 'string' && entry.length <= 200);
    return scalar(value) || (Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every(scalar));
  }
}

export class WorkflowConditionDto {
  @ApiProperty({ enum: WORKFLOW_CONDITION_FIELDS }) @IsIn(WORKFLOW_CONDITION_FIELDS) field!: typeof WORKFLOW_CONDITION_FIELDS[number];
  @ApiProperty({ enum: WORKFLOW_CONDITION_OPERATORS }) @IsIn(WORKFLOW_CONDITION_OPERATORS) operator!: typeof WORKFLOW_CONDITION_OPERATORS[number];
  @ApiProperty({ oneOf: [{ type: 'string', maxLength: 200, nullable: true }, { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', maxLength: 200, nullable: true } }] })
  @Validate(WorkflowConditionValueConstraint) value!: string | null | (string | null)[];
}

export class WorkflowNodeDraftDto {
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(100) id!: string;
  @ApiProperty({ enum: WORKFLOW_EDITABLE_NODE_TYPES, enumName: 'WorkflowEditableNodeType' }) @IsIn(WORKFLOW_EDITABLE_NODE_TYPES) type!: typeof WORKFLOW_EDITABLE_NODE_TYPES[number];
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(200) name!: string;
  @ApiPropertyOptional({ type: WorkflowNodeConfigDto }) @IsOptional() @ValidateNested() @Type(() => WorkflowNodeConfigDto) config?: WorkflowNodeConfigDto;
}

export class WorkflowTransitionDraftDto {
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(100) id!: string;
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(100) from!: string;
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(100) to!: string;
  @ApiPropertyOptional({ enum: WORKFLOW_ACTIONS, enumName: 'WorkflowAction' }) @IsOptional() @IsIn(WORKFLOW_ACTIONS) action?: WorkflowAction;
  @ApiPropertyOptional({ type: WorkflowConditionDto }) @IsOptional() @ValidateNested() @Type(() => WorkflowConditionDto) condition?: WorkflowConditionDto;
}

export class WorkflowGraphDto {
  @ApiProperty({ type: [WorkflowNodeDraftDto], minItems: 1, maxItems: MAX_WORKFLOW_NODES }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_WORKFLOW_NODES) @ValidateNested({ each: true }) @Type(() => WorkflowNodeDraftDto) nodes!: WorkflowNodeDraftDto[];
  @ApiProperty({ type: [WorkflowTransitionDraftDto], maxItems: MAX_WORKFLOW_TRANSITIONS }) @IsArray() @ArrayMaxSize(MAX_WORKFLOW_TRANSITIONS) @ValidateNested({ each: true }) @Type(() => WorkflowTransitionDraftDto) transitions!: WorkflowTransitionDraftDto[];
}

export class WorkflowNodeResponseDto extends OmitType(WorkflowNodeDraftDto, ['type'] as const) {
  @ApiProperty({ enum: WORKFLOW_NODE_TYPES, enumName: 'WorkflowNodeType' }) type!: WorkflowNodeType;
}

export class WorkflowGraphResponseDto extends OmitType(WorkflowGraphDto, ['nodes'] as const) {
  @ApiProperty({ type: [WorkflowNodeResponseDto], minItems: 1, maxItems: MAX_WORKFLOW_NODES }) nodes!: WorkflowNodeResponseDto[];
}

export class CreateWorkflowDto extends WorkflowGraphDto {
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(100) code!: string;
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class UpdateWorkflowDraftDto extends WorkflowGraphDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() draftVersionId!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedRevision!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class PublishWorkflowDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() draftVersionId!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedRevision!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) changeNote?: string;
}

export class CopyWorkflowDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() sourceVersionId!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedRevision!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class WorkflowVersionSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) workflowDefinitionId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: WORKFLOW_VERSION_STATUSES, enumName: 'WorkflowVersionStatus' }) status!: WorkflowVersionStatus;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) publishedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) publishedById!: string | null;
  @ApiProperty({ type: String, nullable: true }) changeNote!: string | null;
}

export class WorkflowVersionResponseDto extends WorkflowVersionSummaryDto {
  @ApiProperty({ type: WorkflowGraphResponseDto }) structureSnapshot!: WorkflowGraphResponseDto;
}

export class WorkflowDefinitionHeaderDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ minimum: 1 }) revision!: number;
}

export class WorkflowDefinitionResponseDto extends WorkflowDefinitionHeaderDto {
  @ApiProperty({ type: WorkflowVersionResponseDto }) version!: WorkflowVersionResponseDto;
}

export class WorkflowDefinitionDetailDto extends WorkflowDefinitionHeaderDto {
  @ApiProperty({ type: [WorkflowVersionSummaryDto] }) versions!: WorkflowVersionSummaryDto[];
}

export class WorkflowDefinitionSummaryDto extends WorkflowDefinitionHeaderDto {
  @ApiProperty({ type: WorkflowVersionSummaryDto }) version!: WorkflowVersionSummaryDto;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) draftVersionId!: string | null;
}

export class WorkflowPageDto {
  @ApiProperty({ type: [WorkflowDefinitionSummaryDto] }) items!: WorkflowDefinitionSummaryDto[];
  @ApiProperty() total!: number;
}

export class WorkflowQueryDto {
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ enum: WORKFLOW_VERSION_STATUSES }) @IsOptional() @IsIn(WORKFLOW_VERSION_STATUSES) status?: WorkflowVersionStatus;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset?: number;
}

export class WorkflowOptionsQueryDto {
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class WorkflowCodeOptionDto {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}

export class WorkflowUserOptionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class WorkflowOptionsDto {
  @ApiProperty({ type: [WorkflowCodeOptionDto] }) roles!: WorkflowCodeOptionDto[];
  @ApiProperty({ type: [WorkflowUserOptionDto] }) users!: WorkflowUserOptionDto[];
  @ApiProperty({ type: [WorkflowCodeOptionDto] }) permissions!: WorkflowCodeOptionDto[];
}

export class WorkflowValidationResponseDto {
  @ApiProperty() valid!: boolean;
  @ApiProperty({ type: [String] }) errors!: string[];
}
