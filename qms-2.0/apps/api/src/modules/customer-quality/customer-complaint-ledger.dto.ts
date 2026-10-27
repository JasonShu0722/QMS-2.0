import { ApiProperty, ApiPropertyOptional, type ApiPropertyOptions } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Allow, ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateBy, ValidateIf, ValidateNested } from 'class-validator';
import { boundedComplaintRaw, type ComplaintFields, type ComplaintNormalized, type ComplaintWarning, type LedgerStage, type LedgerStatus } from './customer-complaint-ledger.types.js';
import { ComponentProjectResolutionDto } from '../platform-configuration/component-project.dto.js';

const rawCell = {
  nullable: true,
  description: 'Original JSON cell; max string length 20000, max depth 4, max 500 nodes and 64000 UTF-8 bytes per row.',
  oneOf: [
    { type: 'string', maxLength: 20000 }, { type: 'number' }, { type: 'boolean' },
    { type: 'array', maxItems: 100, items: {} }, { type: 'object', additionalProperties: true },
  ],
} satisfies ApiPropertyOptions;

export class CustomerLedgerScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}
export class CustomerLedgerFieldsDto {
  @ApiPropertyOptional(rawCell) @Allow() complaintType?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() customerName?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() terminalCustomerName?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() componentCode?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() productModel?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() defectDescription?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() quantity?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() vin?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() barcode?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() batch?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() mileage?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() occurredOn?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() productionOn?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() purchaseOn?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() vehicleDeliveryOn?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() vehicleOfflineOn?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() onlineOn?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() occurredAtLocation?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() occurredAtRegion?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() serviceMode?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() interceptionStatus?: unknown;
  @ApiPropertyOptional(rawCell) @Allow() investigation?: unknown;
}

export class CustomerLedgerCreateDto extends CustomerLedgerScopeDto {
  @ApiProperty({ type: CustomerLedgerFieldsDto, description: 'Bounded raw cells; invalid business values are preserved with null normalized values.' })
  @IsObject() @ValidateBy({ name: 'boundedComplaintRaw', validator: { validate: boundedComplaintRaw } })
  fields!: ComplaintFields;
  @ApiPropertyOptional({ format: 'uuid', type: String, nullable: true }) @ValidateIf((_o, v) => v !== undefined && v !== null) @IsUUID() customerId?: string | null;
  @ApiPropertyOptional({ format: 'uuid', type: String, nullable: true }) @ValidateIf((_o, v) => v !== undefined && v !== null) @IsUUID() qualityEngineerAssignmentId?: string | null;
}
export class CustomerLedgerUpdateDto extends CustomerLedgerCreateDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}
export class CustomerLedgerReassignDto extends CustomerLedgerScopeDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() qualityEngineerAssignmentId!: string;
  @ApiProperty({ minLength: 1, maxLength: 10000 }) @IsString() @MaxLength(10000)
  @ValidateBy({ name: 'nonblankReason', validator: { validate: (value: unknown) => typeof value === 'string' && value.trim().length > 0 && !value.includes('\u0000') } }) reason!: string;
}
export class CustomerLedgerImportRowDto extends CustomerLedgerCreateDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) rowNumber!: number;
  @ApiProperty({ enum: ['ADD', 'SKIP', 'SUPPLEMENT'] }) @IsIn(['ADD', 'SKIP', 'SUPPLEMENT']) action!: 'ADD' | 'SKIP' | 'SUPPLEMENT';
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((o, v) => o.action === 'SUPPLEMENT' || v !== undefined) @IsUUID() targetId?: string;
  @ApiPropertyOptional({ minimum: 1 }) @ValidateIf((o, v) => o.action === 'SUPPLEMENT' || v !== undefined) @IsInt() @Min(1) @Max(2147483647) expectedVersion?: number;
}
export class CustomerLedgerImportDto extends CustomerLedgerScopeDto {
  @ApiProperty({ enum: ['CANCEL', 'CONTINUE', 'SKIP_ERRORS'] }) @IsIn(['CANCEL', 'CONTINUE', 'SKIP_ERRORS']) mode!: 'CANCEL' | 'CONTINUE' | 'SKIP_ERRORS';
  @ApiProperty({ type: [CustomerLedgerImportRowDto], minItems: 1, maxItems: 100 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique((row: CustomerLedgerImportRowDto) => row?.rowNumber)
  @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => CustomerLedgerImportRowDto) rows!: CustomerLedgerImportRowDto[];
}
export class CustomerLedgerNoteDto extends CustomerLedgerScopeDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) note!: string;
}
export class CustomerLedgerReceivingDto extends CustomerLedgerScopeDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @ApiPropertyOptional({ maxLength: 200, type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(200) courierNumber?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date' }) @IsOptional() @IsString() @MaxLength(10) receivedOn?: string | null;
}
export class CustomerLedgerListDto extends CustomerLedgerScopeDto {
  @ApiPropertyOptional({ default: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) page = 1;
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @ApiPropertyOptional({ enum: ['ZERO_KM', 'AFTER_SALES'] }) @IsOptional() @IsIn(['ZERO_KM', 'AFTER_SALES']) complaintType?: string;
  @ApiPropertyOptional({ enum: ['FOLLOWING', 'CLOSED'] }) @IsOptional() @IsIn(['FOLLOWING', 'CLOSED']) status?: LedgerStatus;
  @ApiPropertyOptional({ enum: ['NEW_PRODUCT', 'MASS_PRODUCTION'] }) @IsOptional() @IsIn(['NEW_PRODUCT', 'MASS_PRODUCTION']) stage?: LedgerStage;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) search?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) componentCode?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) projectCode?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() qualityEngineerId?: string;
  @ApiPropertyOptional({ enum: ['true', 'false'] }) @IsOptional() @IsIn(['true', 'false']) mine?: string;
  @ApiPropertyOptional({ enum: ['true', 'false'] }) @IsOptional() @IsIn(['true', 'false']) linked?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsString() @MaxLength(10) occurredFrom?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsString() @MaxLength(10) occurredTo?: string;
}
export class CustomerLedgerWarningDto {
  @ApiProperty() field!: string;
  @ApiProperty() code!: string;
}
export class CustomerLedgerNormalizedDto {
  @ApiProperty({ type: String, nullable: true }) complaintType!: string | null;
  @ApiProperty({ type: String, nullable: true }) customerName!: string | null;
  @ApiProperty({ type: String, nullable: true }) terminalCustomerName!: string | null;
  @ApiProperty({ type: String, nullable: true }) componentCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) productModel!: string | null;
  @ApiProperty({ type: String, nullable: true }) defectDescription!: string | null;
  @ApiProperty({ type: Number, nullable: true }) quantity!: number | null;
  @ApiProperty({ type: String, nullable: true }) vin!: string | null;
  @ApiProperty({ type: String, nullable: true }) barcode!: string | null;
  @ApiProperty({ type: String, nullable: true }) batch!: string | null;
  @ApiProperty({ type: Number, nullable: true }) mileage!: number | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) occurredOn!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) productionOn!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) purchaseOn!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) vehicleDeliveryOn!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) vehicleOfflineOn!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) onlineOn!: string | null;
  @ApiProperty({ type: String, nullable: true }) occurredAtLocation!: string | null;
  @ApiProperty({ type: String, nullable: true }) occurredAtRegion!: string | null;
  @ApiProperty({ type: String, nullable: true }) serviceMode!: string | null;
  @ApiProperty({ type: String, nullable: true }) interceptionStatus!: string | null;
  @ApiProperty({ type: String, nullable: true }) investigation!: string | null;
}
export class CustomerLedgerItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() complaintNumber!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['FOLLOWING', 'CLOSED'] }) status!: LedgerStatus;
  @ApiProperty() legacyStatus!: string;
  @ApiPropertyOptional({ type: Boolean }) archived?: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) customerId!: string | null;
  @ApiProperty({ type: CustomerLedgerNormalizedDto }) normalized!: ComplaintNormalized;
  @ApiProperty({ type: CustomerLedgerFieldsDto }) raw!: ComplaintFields;
  @ApiProperty({ type: [CustomerLedgerWarningDto] }) warnings!: ComplaintWarning[];
  @ApiProperty({ format: 'uuid' }) registeredByUserId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) qualityEngineerId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) qualityEngineerAssignmentId!: string | null;
  @ApiProperty({ type: String, nullable: true, enum: ['MANUAL', 'MAPPING'] }) qualityEngineerSource!: 'MANUAL' | 'MAPPING' | null;
  @ApiProperty({ type: String, nullable: true, enum: ['NEW_PRODUCT', 'MASS_PRODUCTION'] }) stage!: LedgerStage | null;
  @ApiProperty({ type: ComponentProjectResolutionDto, nullable: true }) mapping!: ComponentProjectResolutionDto | null;
  @ApiProperty({ type: String, nullable: true }) mileageBand!: string | null;
  @ApiProperty({ type: Number, nullable: true }) serviceMonths!: number | null;
  @ApiProperty({ type: String, nullable: true }) misTag!: string | null;
  @ApiProperty({ type: String, nullable: true }) courierNumber!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) receivedOn!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) closedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) closedByUserId!: string | null;
  @ApiProperty({ type: String, nullable: true }) closureNote!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class CustomerLedgerPageDto {
  @ApiProperty({ type: [CustomerLedgerItemDto] }) items!: CustomerLedgerItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export class CustomerLedgerImportItemDto {
  @ApiProperty() rowNumber!: number;
  @ApiProperty({ enum: ['CREATED', 'SUPPLEMENTED', 'SKIPPED', 'FAILED', 'CANCELLED', 'PREVIEW'] }) outcome!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) complaintId!: string | null;
  @ApiProperty({ type: String, nullable: true }) errorCode!: string | null;
  @ApiProperty({ type: [CustomerLedgerWarningDto] }) warnings!: ComplaintWarning[];
  @ApiProperty({ type: CustomerLedgerItemDto, nullable: true }) record!: CustomerLedgerItemDto | null;
  @ApiProperty({ type: [CustomerLedgerItemDto] }) similarities!: CustomerLedgerItemDto[];
}
export class CustomerLedgerImportResultDto {
  @ApiProperty({ type: [CustomerLedgerImportItemDto] }) items!: CustomerLedgerImportItemDto[];
  @ApiProperty() created!: number;
  @ApiProperty() supplemented!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty() failed!: number;
  @ApiProperty() pendingCorrection!: number;
}
export class CustomerLedgerCandidateDto {
  @ApiPropertyOptional({ type: Boolean }) projectQualified?: boolean;
  @ApiProperty({ format: 'uuid' }) assignmentId!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ type: String, nullable: true }) username!: string | null;
  @ApiProperty({ type: String, nullable: true }) fullName!: string | null;
  @ApiProperty({ type: String, nullable: true }) departmentName!: string | null;
  @ApiProperty({ type: String, nullable: true }) positionName!: string | null;
}
export class CustomerLedgerCandidatesDto {
  @ApiProperty({ type: [CustomerLedgerCandidateDto] }) items!: CustomerLedgerCandidateDto[];
}
export class CustomerLedgerEventDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() sequence!: number;
  @ApiProperty() eventType!: string;
  @ApiProperty() fromStatus!: string;
  @ApiProperty() toStatus!: string;
  @ApiProperty() note!: string;
  @ApiProperty({ format: 'uuid' }) actorUserId!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class CustomerLedgerDetailDto extends CustomerLedgerItemDto {
  @ApiProperty({ type: [CustomerLedgerEventDto] }) history!: CustomerLedgerEventDto[];
}
