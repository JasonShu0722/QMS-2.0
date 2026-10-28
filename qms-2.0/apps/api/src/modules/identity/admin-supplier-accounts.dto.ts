import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AdminUserDto } from './dto/admin-user.dto.js';

export class AdminSupplierAccountsQueryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 2147483647, default: 0 })
  @Type(() => Number) @IsInt() @Min(0) @Max(2147483647) offset = 0;
}
export class AdminSupplierLifecycleAccountDto extends PickType(AdminUserDto,
  ['id', 'username', 'email', 'accountType', 'status', 'securityVersion', 'organizationId', 'organization'] as const) {}

export class AdminSupplierAccountsPageDto {
  @ApiProperty({ type: [AdminSupplierLifecycleAccountDto] }) items!: AdminSupplierLifecycleAccountDto[];
  @ApiProperty() total!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() offset!: number;
}
export class AdminSupplierAccountTargetDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() organizationId!: string;
}
