import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class PasswordRecoveryDto {
  @ApiProperty({ minLength: 1, maxLength: 254 })
  @IsString() @Length(1, 254)
  identifier!: string;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional() @IsString() @Length(1, 64)
  organizationCode?: string;
}

export class CompleteEmailVerificationDto {
  @ApiProperty({ minLength: 43, maxLength: 43 })
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}

export class CompletePasswordRecoveryDto extends CompleteEmailVerificationDto {
  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString() @Length(12, 128) @MaxLength(128)
  newPassword!: string;
}
