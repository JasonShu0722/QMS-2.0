import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Allow, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class MaterialMasterScopeDto { @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string; }
export class MaterialMasterListQueryDto extends MaterialMasterScopeDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 2147483647, default: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) page = 1;
  @ApiPropertyOptional({ minimum: 1, maximum: 1000, default: 20 }) @Type(() => Number) @IsInt() @Min(1) @Max(1000) pageSize = 20;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value) @IsString() @MaxLength(200) search?: string;
}
export class CreateMaterialMasterDto extends MaterialMasterScopeDto {
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) materialCode!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) materialName!: string;
}
export class UpdateMaterialMasterDto extends MaterialMasterScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) materialName!: string;
}
export class MaterialMasterDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() materialCode!: string;
  @ApiProperty() materialName!: string;
  @ApiProperty() version!: number;
}
export class MaterialMasterPageDto {
  @ApiProperty({ type: [MaterialMasterDto] }) items!: MaterialMasterDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export class MaterialMasterImportRowDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) rowNumber!: number;
  // Row content is validated inside each row transaction, not rejected as a whole batch.
  @ApiProperty({ type: String, maxLength: 100 }) @Allow() materialCode!: unknown;
  @ApiProperty({ type: String, maxLength: 200 }) @Allow() materialName!: unknown;
}
export class MaterialMasterImportDto extends MaterialMasterScopeDto {
  @ApiProperty({ type: [MaterialMasterImportRowDto], minItems: 1, maxItems: 100 }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => MaterialMasterImportRowDto) rows!: MaterialMasterImportRowDto[];
}
export class MaterialMasterImportItemDto {
  @ApiProperty() rowNumber!: number;
  @ApiProperty() code!: string;
  @ApiProperty({ enum: ['CREATED', 'SKIPPED_DUPLICATE', 'FAILED'] }) status!: 'CREATED' | 'SKIPPED_DUPLICATE' | 'FAILED';
  @ApiPropertyOptional() errorCode?: string;
}
export class MaterialMasterImportResultDto {
  @ApiProperty({ type: [MaterialMasterImportItemDto] }) items!: MaterialMasterImportItemDto[];
  @ApiProperty() created!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty() failed!: number;
}
