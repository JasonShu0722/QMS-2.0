import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const SUPPLIER_DOCUMENT_TYPES = ['QUALITY_MANUAL', 'CERTIFICATE', 'PROCESS_CONTROL', 'PPAP', 'OTHER'] as const;
export const SUPPLIER_DOCUMENT_STATUSES = ['DRAFT', 'SUBMITTED', 'NEEDS_CHANGES', 'ACCEPTED'] as const;

export class SupplierAdmissionQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() profileId?: string;
  @ApiPropertyOptional({ enum: SUPPLIER_DOCUMENT_STATUSES }) @IsOptional() @IsIn(SUPPLIER_DOCUMENT_STATUSES) status?: typeof SUPPLIER_DOCUMENT_STATUSES[number];
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class CreateSupplierAdmissionDocumentDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() profileId!: string;
  @ApiProperty({ enum: SUPPLIER_DOCUMENT_TYPES }) @IsIn(SUPPLIER_DOCUMENT_TYPES) documentType!: typeof SUPPLIER_DOCUMENT_TYPES[number];
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) title!: string;
}

export class SubmitSupplierAdmissionDocumentDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() fileId!: string;
}

export class ReviewSupplierAdmissionDocumentDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ enum: ['NEEDS_CHANGES', 'ACCEPTED'] }) @IsIn(['NEEDS_CHANGES', 'ACCEPTED']) decision!: 'NEEDS_CHANGES' | 'ACCEPTED';
  @ApiProperty({ maxLength: 2000 }) @IsString() @MaxLength(2000) note!: string;
}

export class SupplierAdmissionDocumentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) profileId!: string;
  @ApiProperty({ format: 'uuid' }) ownerOrganizationId!: string;
  @ApiProperty({ format: 'uuid' }) supplierOrganizationId!: string;
  @ApiProperty({ enum: SUPPLIER_DOCUMENT_TYPES }) documentType!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: SUPPLIER_DOCUMENT_STATUSES }) status!: string;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) fileId!: string | null;
  @ApiPropertyOptional({ nullable: true }) reviewNote!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class SupplierAdmissionEventDto {
  @ApiProperty() eventType!: string;
  @ApiProperty() documentVersion!: number;
  @ApiProperty({ format: 'uuid' }) actorUserId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) fileId!: string | null;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class SupplierAdmissionDetailDto extends SupplierAdmissionDocumentDto {
  @ApiProperty({ type: [SupplierAdmissionEventDto] }) events!: SupplierAdmissionEventDto[];
}

export class SupplierAdmissionPageDto {
  @ApiProperty({ type: [SupplierAdmissionDocumentDto] }) items!: SupplierAdmissionDocumentDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
