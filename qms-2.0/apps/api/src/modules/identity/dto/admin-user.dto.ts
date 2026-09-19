import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

const ACCOUNT_TYPES = ['INTERNAL', 'SUPPLIER'] as const;
const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;

export class AdminUserListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
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
  @IsString()
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
  @IsOptional()
  @IsIn(ACCOUNT_TYPES)
  accountType?: (typeof ACCOUNT_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];
}

export class ResetAdminUserPasswordDto {
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

  @ApiProperty()
  organization!: { id: string; code: string; name: string };

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
