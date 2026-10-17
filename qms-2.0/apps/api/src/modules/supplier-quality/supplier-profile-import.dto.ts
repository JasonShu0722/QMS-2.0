import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Allow, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export class SupplierProfileImportRowDto {
  @ApiProperty({ minimum: 2, maximum: 1000000 }) @IsInt() @Min(2) @Max(1000000) rowNumber!: number;
  @ApiProperty({ type: String, maxLength: 100 }) @Allow() businessCode!: string;
  @ApiProperty({ type: String, maxLength: 200 }) @Allow() displayName!: string;
  @ApiPropertyOptional({ type: String, maxLength: 100 }) @Allow() contactName?: string;
  @ApiPropertyOptional({ type: String, maxLength: 254 }) @Allow() contactEmail?: string;
}

export class SupplierProfileImportDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ type: [SupplierProfileImportRowDto], minItems: 1, maxItems: 100 })
  @IsArray() @ArrayMinSize(1) @ArrayUnique((row: SupplierProfileImportRowDto | null) => row?.rowNumber) @ValidateNested({ each: true }) @Type(() => SupplierProfileImportRowDto) rows!: SupplierProfileImportRowDto[];
}

export class SupplierProfileImportResultRowDto {
  @ApiProperty() rowNumber!: number;
  @ApiProperty() code!: string;
  @ApiProperty({ enum: ['CREATED', 'SKIPPED_DUPLICATE', 'FAILED'] }) status!: 'CREATED' | 'SKIPPED_DUPLICATE' | 'FAILED';
  @ApiPropertyOptional({ format: 'uuid' }) profileId?: string;
  @ApiPropertyOptional() errorCode?: string;
}

export class SupplierProfileImportResultDto {
  @ApiProperty({ type: [SupplierProfileImportResultRowDto] }) items!: SupplierProfileImportResultRowDto[];
  @ApiProperty() created!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty() failed!: number;
}
