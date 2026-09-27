import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class SupplierInspectionStandardQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() profileId?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) materialCode?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
export class CreateSupplierInspectionStandardDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() profileId!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) materialCode!: string;
  @ApiProperty({ maxLength: 300 }) @IsString() @MaxLength(300) title!: string;
  @ApiPropertyOptional({ minimum: 1, default: 1 }) @IsOptional() @IsInt() @Min(1) revision = 1;
}
export class CreateSupplierInspectionStandardItemDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) itemOrder!: number;
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) itemName!: string;
  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @IsString() @MaxLength(300) characteristic?: string;
  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @IsString() @MaxLength(300) method?: string;
  @ApiPropertyOptional({ maxLength: 80 }) @IsOptional() @IsString() @MaxLength(80) lowerLimit?: string;
  @ApiPropertyOptional({ maxLength: 80 }) @IsOptional() @IsString() @MaxLength(80) upperLimit?: string;
  @ApiPropertyOptional({ maxLength: 40 }) @IsOptional() @IsString() @MaxLength(40) unit?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() required = true;
}
export class SupplierInspectionStandardTransitionDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsString() effectiveFrom?: string; }
export class SupplierInspectionStandardItemDto { @ApiProperty({ format: 'uuid' }) id!: string; @ApiProperty({ format: 'uuid' }) standardId!: string; @ApiProperty() itemOrder!: number; @ApiProperty() itemName!: string; @ApiPropertyOptional({ nullable: true }) characteristic!: string | null; @ApiPropertyOptional({ nullable: true }) method!: string | null; @ApiPropertyOptional({ nullable: true }) lowerLimit!: string | null; @ApiPropertyOptional({ nullable: true }) upperLimit!: string | null; @ApiPropertyOptional({ nullable: true }) unit!: string | null; @ApiProperty() required!: boolean; @ApiProperty() version!: number; }
export class SupplierInspectionStandardDto { @ApiProperty({ format: 'uuid' }) id!: string; @ApiProperty({ format: 'uuid' }) ownerOrganizationId!: string; @ApiProperty({ format: 'uuid' }) supplierOrganizationId!: string; @ApiProperty({ format: 'uuid' }) profileId!: string; @ApiProperty() materialCode!: string; @ApiProperty() title!: string; @ApiProperty() revision!: number; @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'RETIRED'] }) status!: string; @ApiProperty() version!: number; @ApiPropertyOptional({ nullable: true }) effectiveFrom!: string | null; @ApiPropertyOptional({ nullable: true }) effectiveTo!: string | null; @ApiProperty({ type: [SupplierInspectionStandardItemDto] }) items!: SupplierInspectionStandardItemDto[]; @ApiProperty({ format: 'date-time' }) createdAt!: string; @ApiProperty({ format: 'date-time' }) updatedAt!: string; }
export class SupplierInspectionStandardPageDto { @ApiProperty({ type: [SupplierInspectionStandardDto] }) items!: SupplierInspectionStandardDto[]; @ApiProperty() total!: number; @ApiProperty() page!: number; @ApiProperty() pageSize!: number; }
