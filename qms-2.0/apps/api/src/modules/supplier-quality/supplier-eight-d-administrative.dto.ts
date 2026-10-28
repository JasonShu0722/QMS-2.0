import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';

export class SupplierEightDAdministrativeQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 50;
  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 2147483647 })
  @Type(() => Number) @IsInt() @Min(0) @Max(2147483647) offset = 0;
}

export class SupplierEightDAdministrativeReconfigureDto {
  @ApiProperty({ minimum: 1, maximum: 2147483646, description: '当前 supplier 8D control.rowVersion' })
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
  @ApiProperty({ format: 'uuid', description: '失效 SQE 的新有效任职；仅修复 responder 时保留原 SQE 任职' })
  @IsUUID() sqeAssignmentId!: string;
  @ApiPropertyOptional({ format: 'uuid', description: '仅允许补配已经失效的内部答复人' })
  @ValidateIf((_object, value) => value !== undefined) @IsUUID() internalResponderAssignmentId?: string;
}

export class SupplierEightDAdministrativeItemDto {
  @ApiProperty({ format: 'uuid' }) supplierProblemId!: string;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty({ format: 'uuid' }) originalOrganizationId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) sqeUserId!: string;
  @ApiProperty({ format: 'uuid' }) sqeAssignmentId!: string;
  @ApiProperty({ format: 'uuid' }) responsibleSectionDepartmentId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) internalResponderId!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty({ type: [String] }) requiredConfiguration!: string[];
}

export class SupplierEightDAdministrativePageDto {
  @ApiProperty({ type: [SupplierEightDAdministrativeItemDto] }) items!: SupplierEightDAdministrativeItemDto[];
  @ApiProperty() pageSize!: number;
  @ApiProperty() offset!: number;
  @ApiProperty({ type: Number, nullable: true, description: '下一扫描窗口，不是失效记录排名' }) nextOffset!: number | null;
}

export class SupplierEightDAdministrativeResultDto {
  @ApiProperty({ format: 'uuid' }) supplierProblemId!: string;
  @ApiProperty({ format: 'uuid' }) problemId!: string;
  @ApiProperty() reportNumber!: string;
  @ApiProperty({ format: 'uuid' }) originalOrganizationId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() problemVersion!: number;
  @ApiProperty({ format: 'uuid' }) sqeUserId!: string;
  @ApiProperty({ format: 'uuid' }) sqeAssignmentId!: string;
  @ApiProperty({ format: 'uuid' }) responsibleSectionDepartmentId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) internalResponderId!: string | null;
  @ApiProperty() status!: string;
}
