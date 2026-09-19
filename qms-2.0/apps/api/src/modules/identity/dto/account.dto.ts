import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class OrganizationSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;
}

export class AccountProfileDto {
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

  @ApiProperty({ type: OrganizationSummaryDto })
  organization!: OrganizationSummaryDto;
}

export class UpdateAccountProfileDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 254 })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;
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
