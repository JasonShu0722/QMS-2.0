import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { SUPPLIER_REPLY_MODES, SUPPLIER_SEVERITIES, type SupplierProblemFacts } from './supplier-quality.types.js';
import { RESPONSE_FORMS, type ResponseForm } from '../problem-index/problem.types.js';

export class SupplierBindingScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}

export class SupplierBindingSelectorDto {
  @ApiProperty({ enum: SUPPLIER_SEVERITIES }) @IsIn(SUPPLIER_SEVERITIES) severity!: SupplierProblemFacts['severity'];
  @ApiProperty({ enum: RESPONSE_FORMS }) @IsIn(RESPONSE_FORMS) responseForm!: ResponseForm;
  @ApiProperty({ enum: SUPPLIER_REPLY_MODES }) @IsIn(SUPPLIER_REPLY_MODES) replyMode!: SupplierProblemFacts['replyMode'];
}

export class SetSupplierWorkflowBindingDto extends SupplierBindingSelectorDto {
  @ApiProperty({ minimum: 0, maximum: 2147483646 }) @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() workflowVersionId!: string;
  @ApiProperty() @IsBoolean() enabled!: boolean;
}

export class ActivateSupplierWorkflowBindingDto extends SupplierBindingSelectorDto {
  @ApiProperty({ minimum: 1, maximum: 2147483646 }) @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
  @ApiProperty() @IsBoolean() enabled!: boolean;
}

export class SupplierWorkflowBindingDto extends SupplierBindingSelectorDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ format: 'uuid' }) workflowVersionId!: string;
  @ApiProperty({ format: 'uuid' }) workflowDefinitionId!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'RETIRED'] }) workflowStatus!: string;
  @ApiProperty({ type: Number, nullable: true, description: '固定流程版本回复节点的分钟数；未配置则为 null' }) responseSlaMinutes!: number | null;
  @ApiPropertyOptional({ description: '完整供应商8D；绑定后仍须显式启用，不使用旧节点SLA' }) controlledEightD?: boolean;
  @ApiProperty({ format: 'uuid' }) createdById!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class SupplierWorkflowBindingsDto {
  @ApiProperty({ type: [SupplierWorkflowBindingDto] }) items!: SupplierWorkflowBindingDto[];
}
