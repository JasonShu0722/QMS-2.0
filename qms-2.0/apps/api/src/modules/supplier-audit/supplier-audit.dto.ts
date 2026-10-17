import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export const SUPPLIER_AUDIT_TYPES = ['ANNUAL', 'SPECIAL'] as const;
export const SUPPLIER_AUDIT_PLAN_STATUSES = ['PLANNED', 'SUBMITTED', 'CLOSED', 'CANCELLED'] as const;
export const SUPPLIER_AUDIT_RECORD_STATUSES = ['DRAFT', 'SUBMITTED', 'CLOSED'] as const;
export const SUPPLIER_AUDIT_CONCLUSIONS = ['PASS', 'CONDITIONAL', 'FAIL'] as const;
export const SUPPLIER_AUDIT_CHECKLIST_RESULTS = ['PASS', 'MINOR_NC', 'MAJOR_NC', 'NA'] as const;

export class SupplierAuditQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() profileId?: string;
  @ApiPropertyOptional({ minimum: 2000, maximum: 2200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2200) year?: number;
  @ApiPropertyOptional({ enum: [...SUPPLIER_AUDIT_PLAN_STATUSES, ...SUPPLIER_AUDIT_RECORD_STATUSES] }) @IsOptional() @IsIn([...SUPPLIER_AUDIT_PLAN_STATUSES, ...SUPPLIER_AUDIT_RECORD_STATUSES]) status?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class CreateSupplierAuditPlanDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() profileId!: string;
  @ApiProperty({ minimum: 2000, maximum: 2200 }) @IsInt() @Min(2000) @Max(2200) auditYear!: number;
  @ApiProperty({ enum: SUPPLIER_AUDIT_TYPES }) @IsIn(SUPPLIER_AUDIT_TYPES) auditType!: typeof SUPPLIER_AUDIT_TYPES[number];
  @ApiProperty({ maxLength: 300 }) @IsString() @MaxLength(300) title!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() plannedStart!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() plannedEnd!: string;
}

export class SupplierAuditTransitionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class CreateSupplierAuditRecordDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() planId!: string;
  @ApiProperty({ format: 'date' }) @IsDateString() auditDate!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) auditor!: string;
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) summary!: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() findings?: Record<string, unknown>;
}

export class CloseSupplierAuditRecordDto extends SupplierAuditTransitionDto {
  @ApiProperty({ enum: SUPPLIER_AUDIT_CONCLUSIONS }) @IsIn(SUPPLIER_AUDIT_CONCLUSIONS) conclusion!: typeof SUPPLIER_AUDIT_CONCLUSIONS[number];
  @ApiProperty({ maxLength: 2000 }) @IsString() @MaxLength(2000) closeNote!: string;
}

export class SupplierAuditChecklistItemInputDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @MaxLength(64) code!: string;
  @ApiProperty({ maxLength: 300 }) @IsString() @MaxLength(300) title!: string;
  @ApiProperty({ enum: SUPPLIER_AUDIT_CHECKLIST_RESULTS }) @IsIn(SUPPLIER_AUDIT_CHECKLIST_RESULTS) result!: typeof SUPPLIER_AUDIT_CHECKLIST_RESULTS[number];
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 10 }) @IsArray() @ArrayMaxSize(10) @IsUUID(undefined, { each: true }) evidenceFileIds!: string[];
}

export class UpdateSupplierAuditChecklistDto extends SupplierAuditTransitionDto {
  @ApiProperty({ type: [SupplierAuditChecklistItemInputDto], maxItems: 100 })
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SupplierAuditChecklistItemInputDto)
  items!: SupplierAuditChecklistItemInputDto[];
}

export class SupplierAuditChecklistItemDto {
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: SUPPLIER_AUDIT_CHECKLIST_RESULTS }) result!: string;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty({ type: [String], format: 'uuid' }) evidenceFileIds!: string[];
}

export class SupplierAuditChecklistDto {
  @ApiProperty({ format: 'uuid' }) recordId!: string;
  @ApiProperty() recordVersion!: number;
  @ApiProperty({ type: [SupplierAuditChecklistItemDto] }) items!: SupplierAuditChecklistItemDto[];
}

export class SupplierAuditPlanDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) ownerOrganizationId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) supplierOrganizationId!: string | null;
  @ApiProperty({ format: 'uuid' }) profileId!: string;
  @ApiProperty() auditYear!: number;
  @ApiProperty({ enum: SUPPLIER_AUDIT_TYPES }) auditType!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date-time' }) plannedStart!: string;
  @ApiProperty({ format: 'date-time' }) plannedEnd!: string;
  @ApiProperty({ enum: SUPPLIER_AUDIT_PLAN_STATUSES }) status!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class SupplierAuditRecordDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) ownerOrganizationId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) supplierOrganizationId!: string | null;
  @ApiProperty({ format: 'uuid' }) profileId!: string;
  @ApiProperty({ format: 'uuid' }) planId!: string;
  @ApiProperty({ format: 'date' }) auditDate!: string;
  @ApiProperty() auditor!: string;
  @ApiProperty() summary!: string;
  @ApiProperty({ type: Object }) findings!: Record<string, unknown>;
  @ApiPropertyOptional({ enum: SUPPLIER_AUDIT_CONCLUSIONS, nullable: true }) conclusion!: string | null;
  @ApiPropertyOptional({ nullable: true }) closeNote!: string | null;
  @ApiProperty({ enum: SUPPLIER_AUDIT_RECORD_STATUSES }) status!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class SupplierAuditPlanPageDto {
  @ApiProperty({ type: [SupplierAuditPlanDto] }) items!: SupplierAuditPlanDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class SupplierAuditRecordPageDto {
  @ApiProperty({ type: [SupplierAuditRecordDto] }) items!: SupplierAuditRecordDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
