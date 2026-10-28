import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min } from 'class-validator';
import { TemporaryPasswordDto } from '../identity/dto/password-change-challenge.dto.js';

export class SupplierAccountScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}

export class CreateSupplierAccountDto extends SupplierAccountScopeDto {
  @ApiProperty({ minLength: 1, maxLength: 100 }) @IsString() @Length(1, 100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @Matches(/^[a-zA-Z0-9._-]+$/) username!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 254 }) @IsOptional() @IsEmail() @MaxLength(254) email?: string | null;
  @ApiPropertyOptional({ format: 'uuid', description: '仅首次绑定可选，必须具备目标供应商企业的实际账号治理权限' }) @IsOptional() @IsUUID() supplierOrganizationId?: string;
}

export class SetSupplierAccountStatusDto extends SupplierAccountScopeDto {
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) @IsIn(['ACTIVE', 'DISABLED']) status!: 'ACTIVE' | 'DISABLED';
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedSecurityVersion!: number;
}

export class SupplierAccountDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) status!: string;
  @ApiProperty() securityVersion!: number;
}

export class CreatedSupplierAccountDto extends SupplierAccountDto {
  @ApiProperty({ type: TemporaryPasswordDto }) temporaryPassword!: TemporaryPasswordDto;
}

export class SupplierAccountPageDto {
  @ApiProperty({ type: [SupplierAccountDto] }) items!: SupplierAccountDto[];
  @ApiProperty() canCreate!: boolean;
  @ApiProperty() canReset!: boolean;
  @ApiProperty() canSetStatus!: boolean;
  @ApiProperty() canDelete!: boolean;
}
