import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { LoginResponseDto } from './login.dto.js';

export class MfaCodeDto {
  @ApiProperty({ minLength: 6, maxLength: 43 })
  @IsString()
  @Length(6, 43)
  code!: string;
}

export class ReauthenticateDto {
  @ApiProperty({ minLength: 1, maxLength: 256 })
  @IsString()
  @Length(1, 256)
  password!: string;

  @ApiPropertyOptional({ minLength: 6, maxLength: 43 })
  @IsOptional()
  @IsString()
  @Length(6, 43)
  code?: string;
}

export class SecurityStatusDto {
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  emailVerifiedAt!: string | null;

  @ApiProperty()
  mfaEnabled!: boolean;

  @ApiProperty()
  mfaRequired!: boolean;

  @ApiProperty({ enum: ['AUTHENTICATED', 'MFA_REQUIRED', 'MFA_ENROLLMENT_REQUIRED'] })
  securityState!: string;

  @ApiProperty()
  recoveryCodesRemaining!: number;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  reauthenticationExpiresAt!: string | null;
}

export class MfaEnrollmentDto {
  @ApiProperty()
  secret!: string;

  @ApiProperty()
  otpauthUri!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class RecoveryCodesDto {
  @ApiProperty({ type: [String], description: 'Shown once. Store offline; each code can be used once.' })
  recoveryCodes!: string[];
}

export class MfaEnrollmentCompleteDto extends LoginResponseDto {
  @ApiProperty({ type: [String] })
  recoveryCodes!: string[];
}

export class ReauthenticationResponseDto {
  @ApiProperty({ format: 'date-time' })
  reauthenticationExpiresAt!: string;
}
