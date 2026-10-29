import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';

export class InternalEightDAdministrativeQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;

  // shortcut: numeric scan offsets suit the initial dataset; use keyset cursors before two billion reports.
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 2147483647, default: 0 })
  @Type(() => Number) @IsInt() @Min(0) @Max(2147483647) offset = 0;
}

export class InternalEightDAdministrativeReconfigureDto {
  @ApiProperty({ type: Number, minimum: 1, maximum: 2147483646 })
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined) @IsUUID() professionalAssignmentId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined) @IsUUID() ownerAssignmentId?: string;
}

export class InternalEightDAdministrativeResultDto {
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty({ format: 'uuid' }) originalOrganizationId!: string;
  @ApiProperty() domainCode!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty() version!: number;
  @ApiProperty() problemVersion!: number;
  @ApiProperty({ format: 'uuid' }) professionalUserId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) ownerUserId!: string | null;
  @ApiProperty({ format: 'uuid' }) responsibleSectionDepartmentId!: string;
  @ApiProperty({ enum: ['PROCESSING'] }) status!: 'PROCESSING';
}

export class InternalEightDAdministrativePendingItemDto extends InternalEightDAdministrativeResultDto {
  @ApiProperty({ type: [String], enum: ['professionalAssignmentId', 'ownerAssignmentId'] })
  requiredConfiguration!: ('professionalAssignmentId' | 'ownerAssignmentId')[];
}

export class InternalEightDAdministrativePendingPageDto {
  @ApiProperty({ type: [InternalEightDAdministrativePendingItemDto] }) items!: InternalEightDAdministrativePendingItemDto[];
  @ApiProperty() pageSize!: number;
  @ApiProperty() offset!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Next report scan offset, not the rank among invalid references' }) nextOffset!: number | null;
}
