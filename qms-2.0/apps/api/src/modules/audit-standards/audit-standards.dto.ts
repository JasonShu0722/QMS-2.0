import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDefined, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuditScopeDto } from '../audit-management/audit-management.dto.js';
import type { AuditType } from '../audit-management/audit-management.service.js';

const auditTypes = ['SYSTEM', 'PROCESS', 'PRODUCT', 'SECOND_PARTY', 'CUSTOMER'] as const;

export class AuditStandardCheckItemDto {
  @ApiProperty({ maxLength: 120 }) @IsString() @MaxLength(120) key!: string;
  @ApiProperty({ maxLength: 2000 }) @IsString() @MaxLength(2000) text!: string;
}

export class AuditStandardDefinitionDto {
  @ApiProperty({ type: [AuditStandardCheckItemDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AuditStandardCheckItemDto) items!: AuditStandardCheckItemDto[];
}

export class CreateAuditStandardDto extends AuditScopeDto {
  @ApiProperty({ maxLength: 300 }) @IsString() @MaxLength(300) name!: string;
  @ApiProperty({ enum: auditTypes }) @IsIn(auditTypes) auditType!: AuditType;
  @ApiProperty({ type: AuditStandardDefinitionDto }) @IsDefined() @ValidateNested() @Type(() => AuditStandardDefinitionDto) definition!: AuditStandardDefinitionDto;
}

export class UpdateAuditStandardDto extends AuditScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ type: AuditStandardDefinitionDto }) @IsDefined() @ValidateNested() @Type(() => AuditStandardDefinitionDto) definition!: AuditStandardDefinitionDto;
}

export class AuditStandardQueryDto extends AuditScopeDto {
  @ApiPropertyOptional({ enum: auditTypes }) @IsOptional() @IsIn(auditTypes) auditType?: AuditType;
  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @IsString() @MaxLength(300) search?: string;
  @ApiPropertyOptional({ minimum: 1, default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class AuditStandardItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: auditTypes }) auditType!: AuditType;
  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED'] }) status!: string;
  @ApiProperty() version!: number;
  @ApiProperty() latestVersion!: number;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}

export class AuditStandardPageDto {
  @ApiProperty({ type: [AuditStandardItemDto] }) items!: AuditStandardItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class AuditStandardVersionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: AuditStandardDefinitionDto }) definition!: AuditStandardDefinitionDto;
  @ApiProperty({ format: 'date-time' }) publishedAt!: Date;
  @ApiProperty({ format: 'uuid' }) publishedById!: string;
}

export class AuditStandardDetailDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: auditTypes }) auditType!: AuditType;
  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED'] }) status!: string;
  @ApiProperty() version!: number;
  @ApiProperty() latestVersion!: number;
  @ApiProperty({ type: AuditStandardDefinitionDto }) draftDefinition!: AuditStandardDefinitionDto;
  @ApiProperty({ type: [AuditStandardVersionDto] }) versions!: AuditStandardVersionDto[];
}
