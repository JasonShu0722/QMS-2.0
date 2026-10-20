import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class OrganizationSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;
}

export class AccountProfileDto {
  @ApiProperty({ type: String, nullable: true, maxLength: 100 })
  fullName!: string | null;

  @ApiProperty({ type: String, nullable: true, maxLength: 40 })
  phone!: string | null;

  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  profileVersion!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  emailVerifiedAt!: string | null;

  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ enum: ['INTERNAL', 'SUPPLIER'] })
  accountType!: 'INTERNAL' | 'SUPPLIER';

  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  status!: 'ACTIVE' | 'DISABLED';

  @ApiProperty()
  mfaEnabled!: boolean;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  avatarFileId!: string | null;

  @ApiProperty({ minimum: 1 })
  avatarVersion!: number;

  @ApiProperty({ type: OrganizationSummaryDto })
  organization!: OrganizationSummaryDto;
}

export class UpdateAccountAvatarDto {
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  fileId!: string | null;

  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  @IsInt() @Min(1) @Max(2147483647)
  expectedVersion!: number;
}

export class ProfileFieldsDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() || null : value)
  @IsOptional() @IsString() @MaxLength(100)
  fullName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 40 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() || null : value)
  @IsOptional() @IsString() @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 254 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() || null : value)
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;
}

export class UpdateAccountProfileDto extends ProfileFieldsDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  @IsInt() @Min(1) @Max(2147483647)
  expectedProfileVersion!: number;
}

export class ChangePasswordDto {
  @ApiProperty({ minLength: 12, maxLength: 256 })
  @IsString()
  @Length(1, 256)
  currentPassword!: string;

  @ApiProperty({ minLength: 12, maxLength: 256 })
  @IsString()
  @Length(12, 256)
  newPassword!: string;
}

export class AccountSessionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  revokedAt!: string | null;

  @ApiProperty()
  isCurrent!: boolean;
}

export class AccountSessionHistoryQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1, maximum: 1000000 })
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize = 20;
}

export class AccountSessionHistoryItemDto extends AccountSessionDto {
  @ApiProperty({ enum: ['STANDARD', 'REMEMBERED_ADMIN', 'REMEMBERED_USER'] })
  lifetimeType!: 'STANDARD' | 'REMEMBERED_ADMIN' | 'REMEMBERED_USER';

  @ApiProperty({ enum: ['ACTIVE', 'REVOKED', 'EXPIRED'] })
  status!: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
}

export class AccountSessionHistoryPageDto {
  @ApiProperty({ type: [AccountSessionHistoryItemDto] })
  items!: AccountSessionHistoryItemDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}
