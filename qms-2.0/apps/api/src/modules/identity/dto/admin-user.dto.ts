import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { OrganizationSummaryDto } from './account.dto.js';

const ACCOUNT_TYPES = ['INTERNAL', 'SUPPLIER'] as const;
const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;

export class AdminUserListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];

  @ApiPropertyOptional({ enum: ACCOUNT_TYPES })
  @IsOptional()
  @IsIn(ACCOUNT_TYPES)
  accountType?: (typeof ACCOUNT_TYPES)[number];

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateAdminUserDto {
  @ApiProperty()
  @IsString()
  @Length(1, 100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @Matches(/^[a-zA-Z0-9._-]+$/)
  username!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiProperty({ enum: ACCOUNT_TYPES })
  @IsIn(ACCOUNT_TYPES)
  accountType!: (typeof ACCOUNT_TYPES)[number];

  @ApiProperty()
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ minLength: 12, maxLength: 256 })
  @IsString()
  @Length(12, 256)
  initialPassword!: string;
}

export class UpdateAdminUserDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ enum: ACCOUNT_TYPES })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(ACCOUNT_TYPES)
  accountType?: (typeof ACCOUNT_TYPES)[number];

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];
}

export class ResetAdminUserPasswordDto {
  @ApiProperty({ minLength: 32, maxLength: 256 })
  @IsString()
  @Length(32, 256)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  temporaryCode!: string;
}

export class PasswordResetIssuedDto {
  @ApiProperty({ format: 'uuid' })
  resetId!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class CompletePasswordResetDto extends ResetAdminUserPasswordDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  resetId!: string;

  @ApiProperty({ minLength: 12, maxLength: 256 })
  @IsString()
  @Length(12, 256)
  newPassword!: string;
}

export class AdminUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ enum: ACCOUNT_TYPES })
  accountType!: (typeof ACCOUNT_TYPES)[number];

  @ApiProperty({ enum: USER_STATUSES })
  status!: (typeof USER_STATUSES)[number];

  @ApiProperty()
  mfaEnabled!: boolean;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty({ type: OrganizationSummaryDto })
  organization!: OrganizationSummaryDto;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class AdminOrganizationDto extends OrganizationSummaryDto {
  @ApiProperty({ enum: ACCOUNT_TYPES })
  type!: (typeof ACCOUNT_TYPES)[number];

  @ApiProperty({ type: [String] })
  permissions!: string[];
}
