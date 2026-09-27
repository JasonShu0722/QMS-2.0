import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export const PCN_TYPES = ['MATERIAL', 'PROCESS', 'EQUIPMENT', 'SITE'] as const;
export const PCN_STATUSES = ['DRAFT', 'SUBMITTED', 'NEEDS_CHANGES', 'APPROVED', 'CLOSED'] as const;
export class SupplierPcnQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ enum: PCN_STATUSES }) @IsOptional() @IsIn(PCN_STATUSES) status?: typeof PCN_STATUSES[number];
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
export class SupplierPcnFactsDto {
  @ApiProperty({ enum: PCN_TYPES }) @IsIn(PCN_TYPES) changeType!: typeof PCN_TYPES[number];
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) title!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) materialCode!: string;
  @ApiProperty({ maxLength: 4000 }) @IsString() @MaxLength(4000) beforeChange!: string;
  @ApiProperty({ maxLength: 4000 }) @IsString() @MaxLength(4000) afterChange!: string;
  @ApiProperty({ maxLength: 2000 }) @IsString() @MaxLength(2000) reason!: string;
  @ApiProperty({ maxLength: 4000 }) @IsString() @MaxLength(4000) riskControl!: string;
  @ApiProperty({ format: 'date' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) plannedDate!: string;
}
export class CreateSupplierPcnDto extends SupplierPcnFactsDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() profileId!: string;
}
export class SupplierPcnVersionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}
export class UpdateSupplierPcnDto extends SupplierPcnFactsDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}
export class SubmitSupplierPcnDto extends SupplierPcnVersionDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() fileId!: string;
}
export class StartSupplierPcnWorkflowDto extends SupplierPcnVersionDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() workflowDefinitionId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() workflowVersionId!: string;
}
export class ReviewSupplierPcnDto extends SupplierPcnVersionDto {
  @ApiProperty({ enum: ['APPROVE', 'RETURN', 'CLOSE'] }) @IsIn(['APPROVE', 'RETURN', 'CLOSE']) action!: 'APPROVE' | 'RETURN' | 'CLOSE';
  @ApiProperty({ maxLength: 2000 }) @IsString() @MaxLength(2000) note!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedWorkflowVersion!: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedProblemVersion!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() currentNodeId!: string;
}
export class AdvanceSupplierPcnDto extends SupplierPcnVersionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedWorkflowVersion!: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedProblemVersion!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() currentNodeId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() fileId!: string;
}
export class SupplierPcnDto extends SupplierPcnFactsDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) profileId!: string;
  @ApiProperty({ format: 'uuid' }) ownerOrganizationId!: string;
  @ApiProperty({ format: 'uuid' }) supplierOrganizationId!: string;
  @ApiProperty() supplierName!: string;
  @ApiProperty({ enum: PCN_STATUSES }) status!: string;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ nullable: true, format: 'uuid', type: String }) fileId!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid', type: String }) problemIndexId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) reviewNote!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class SupplierPcnEventDto {
  @ApiProperty() eventType!: string;
  @ApiProperty() pcnVersion!: number;
  @ApiProperty({ format: 'uuid' }) actorUserId!: string;
  @ApiProperty({ type: SupplierPcnDto }) snapshot!: SupplierPcnDto;
  @ApiPropertyOptional({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class SupplierPcnWorkflowDto {
  @ApiProperty({ format: 'uuid' }) instanceId!: string;
  @ApiProperty({ format: 'uuid' }) currentNodeId!: string;
  @ApiProperty({ format: 'uuid' }) workflowVersionId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() problemVersion!: number;
  @ApiProperty() status!: string;
  @ApiProperty() nodeType!: string;
}
export class SupplierPcnDetailDto extends SupplierPcnDto {
  @ApiProperty({ type: [SupplierPcnEventDto] }) events!: SupplierPcnEventDto[];
  @ApiPropertyOptional({ type: SupplierPcnWorkflowDto, nullable: true }) workflow!: SupplierPcnWorkflowDto | null;
}
export class SupplierPcnPageDto {
  @ApiProperty({ type: [SupplierPcnDto] }) items!: SupplierPcnDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export class SupplierPcnProfileDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) ownerOrganizationId!: string;
  @ApiProperty({ format: 'uuid' }) supplierOrganizationId!: string;
  @ApiProperty() displayName!: string;
}
export class SupplierPcnProfilesDto {
  @ApiProperty({ type: [SupplierPcnProfileDto] }) items!: SupplierPcnProfileDto[];
}
