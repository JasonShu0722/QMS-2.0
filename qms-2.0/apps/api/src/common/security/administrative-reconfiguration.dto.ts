import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AdministrativeReconfigurationKind {
  ORGANIZATION = 'ORGANIZATION',
  DEPARTMENT = 'DEPARTMENT',
  POSITION = 'POSITION',
  USER = 'USER',
}
export type StructureReconfigurationKind = Exclude<AdministrativeReconfigurationKind, AdministrativeReconfigurationKind.USER>;

export class AdministrativeReconfigurationQueryDto {
  @ApiProperty({ enum: AdministrativeReconfigurationKind })
  @IsEnum(AdministrativeReconfigurationKind)
  kind!: AdministrativeReconfigurationKind;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 2147483647 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  offset = 0;
}

export class AdministrativeReconfigurationDto {
  @ApiProperty({ minimum: 1, maximum: 2147483646, description: '实体 version；USER 使用 securityVersion' })
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  targetOrganizationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  targetDepartmentId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'DEPARTMENT 可显式选择 null 根部门；ORGANIZATION 必须选择有效内部父组织' })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID()
  parentId?: string | null;
}

export class AdministrativeReconfigurationItemDto {
  @ApiProperty({ enum: AdministrativeReconfigurationKind }) kind!: AdministrativeReconfigurationKind;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ format: 'uuid' }) originalOrganizationId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() reason!: string;
  @ApiProperty({ type: [String] }) requiredConfiguration!: string[];
}

export class AdministrativeReconfigurationPageDto {
  @ApiProperty({ type: [AdministrativeReconfigurationItemDto] }) items!: AdministrativeReconfigurationItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() offset!: number;
}

export class AdministrativeReconfigurationResultDto {
  @ApiProperty({ enum: AdministrativeReconfigurationKind }) kind!: AdministrativeReconfigurationKind;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) originalOrganizationId!: string;
  @ApiProperty({ format: 'uuid' }) targetOrganizationId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) status!: 'ACTIVE' | 'DISABLED';
  @ApiProperty({ enum: [false] }) configurationRequired!: false;
  @ApiPropertyOptional({ format: 'uuid' }) replacementId?: string;
}
