import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDefined, IsIn, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { SUPPLIER_COPY_SOURCE_KINDS, type SupplierCopySourceKind } from '../../common/eight-d/supplier-copy.types.js';
import { SupplierProblemDraftDto } from '../supplier-quality/supplier-quality.dto.js';

export class SupplierCopySourceDto {
  @ApiProperty({ enum: SUPPLIER_COPY_SOURCE_KINDS }) @IsIn(SUPPLIER_COPY_SOURCE_KINDS) kind!: SupplierCopySourceKind;
  @ApiProperty({ format: 'uuid' }) @IsUUID() sourceId!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) sourceVersion!: number;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() materialItemId?: string;
}

export class SupplierCopyPreviewInputDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() supplierProfileId!: string;
  @ApiProperty({ type: [SupplierCopySourceDto], minItems: 1, maxItems: 100 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SupplierCopySourceDto) sources!: SupplierCopySourceDto[];
}

export class SupplierCopyMaterialDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true }) materialCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) materialName!: string | null;
  @ApiProperty({ type: String, nullable: true }) materialBatch!: string | null;
}

export class SupplierCopyFactDto {
  @ApiProperty() factKey!: string;
  @ApiProperty() defectDescription!: string;
  @ApiProperty({ type: Number, nullable: true }) defectQuantity!: number | null;
  @ApiProperty({ type: [SupplierCopyMaterialDto] }) materials!: SupplierCopyMaterialDto[];
}

export class SupplierCopyPreviewDto {
  @ApiProperty({ format: 'uuid' }) token!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: [SupplierCopyFactDto] }) facts!: SupplierCopyFactDto[];
}

export class SupplierCopyDraftInputDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() token!: string;
  @ApiProperty({ type: SupplierProblemDraftDto }) @IsDefined() @ValidateNested() @Type(() => SupplierProblemDraftDto) draft!: SupplierProblemDraftDto;
}

export class SupplierCopyDraftReceiptDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['DRAFT'] }) stage!: 'DRAFT';
}
