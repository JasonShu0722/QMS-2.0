import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const PPAP_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export const PPAP_ITEM_STATUSES = ['PENDING', 'PROVIDED', 'ACCEPTED', 'REJECTED'] as const;

export class SupplierPpapQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ enum: PPAP_STATUSES }) @IsOptional() @IsIn(PPAP_STATUSES) status?: typeof PPAP_STATUSES[number];
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) level?: number;
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class CreateSupplierPpapDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() profileId!: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) level!: number;
  @ApiProperty({ maxLength: 300 }) @IsString() @MaxLength(300) title!: string;
  @ApiProperty({ maxLength: 120 }) @IsString() @MaxLength(120) partNumber!: string;
}

export class CreateSupplierPpapItemDto {
  @ApiProperty({ maxLength: 80 }) @IsString() @MaxLength(80) itemCode!: string;
  @ApiProperty({ maxLength: 300 }) @IsString() @MaxLength(300) title!: string;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() required = true;
  @ApiPropertyOptional({ type: Object, default: {} }) @IsOptional() @IsObject() content: Record<string, unknown> = {};
}

export class SupplierPpapTransitionDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; }

export class SupplierPpapEvidenceDto extends SupplierPpapTransitionDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 10 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsUUID('4', { each: true }) evidenceFileIds!: string[];
}

export class ReviewSupplierPpapDto extends SupplierPpapTransitionDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @ApiProperty({ maxLength: 2000 }) @IsString() @MaxLength(2000) note!: string;
}

export class ReviewSupplierPpapItemDto extends SupplierPpapTransitionDto {
  @ApiProperty({ enum: ['ACCEPTED', 'REJECTED'] }) @IsIn(['ACCEPTED', 'REJECTED']) decision!: 'ACCEPTED' | 'REJECTED';
  @ApiProperty({ maxLength: 2000 }) @IsString() @MaxLength(2000) note!: string;
}

export class RequalifySupplierPpapDto extends SupplierPpapTransitionDto {
  @ApiProperty({ maxLength: 2000 }) @IsString() @MaxLength(2000) note!: string;
}

export class SupplierPpapItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) packageId!: string;
  @ApiProperty({ maxLength: 80 }) itemCode!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty() required!: boolean;
  @ApiProperty({ enum: PPAP_ITEM_STATUSES }) status!: string;
  @ApiProperty({ type: Object }) content!: Record<string, unknown>;
  @ApiProperty({ type: [String], format: 'uuid' }) evidenceFileIds!: string[];
  @ApiPropertyOptional({ type: String, nullable: true }) reviewNote!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) reviewedAt!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class SupplierPpapDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) ownerOrganizationId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) supplierOrganizationId!: string | null;
  @ApiProperty({ format: 'uuid' }) profileId!: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) level!: number;
  @ApiProperty() title!: string;
  @ApiProperty() partNumber!: string;
  @ApiProperty({ enum: PPAP_STATUSES }) status!: string;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) reviewNote!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) requalificationDueAt!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) lastRequalifiedAt!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) requalificationNote!: string | null;
  @ApiProperty({ type: [SupplierPpapItemDto] }) items!: SupplierPpapItemDto[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class SupplierPpapPageDto { @ApiProperty({ type: [SupplierPpapDto] }) items!: SupplierPpapDto[]; @ApiProperty() total!: number; @ApiProperty() page!: number; @ApiProperty() pageSize!: number; }
