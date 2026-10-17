import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ minLength: 1, maxLength: 254 })
  @IsString()
  @Length(1, 254)
  identifier!: string;

  @ApiProperty({ minLength: 1, maxLength: 256 })
  @IsString()
  @Length(1, 256)
  password!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class LoginResponseDto {
  @ApiProperty({ enum: ['INTERNAL', 'SUPPLIER'] })
  accountType!: 'INTERNAL' | 'SUPPLIER';

  @ApiProperty({ enum: ['/app/workbench', '/supplier/inbox', '/mfa', '/change-password'] })
  landingPath!: '/app/workbench' | '/supplier/inbox' | '/mfa' | '/change-password';

  @ApiProperty({ enum: ['AUTHENTICATED', 'MFA_REQUIRED', 'MFA_ENROLLMENT_REQUIRED', 'PASSWORD_CHANGE_REQUIRED'] })
  securityState!: 'AUTHENTICATED' | 'MFA_REQUIRED' | 'MFA_ENROLLMENT_REQUIRED' | 'PASSWORD_CHANGE_REQUIRED';
}

export class SessionUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty({ enum: ['INTERNAL', 'SUPPLIER'] })
  accountType!: 'INTERNAL' | 'SUPPLIER';
}

export class SessionResponseDto {
  @ApiProperty({ type: SessionUserDto })
  user!: SessionUserDto;

  @ApiProperty({ enum: ['/app/workbench', '/supplier/inbox'] })
  landingPath!: '/app/workbench' | '/supplier/inbox';

  @ApiProperty({ enum: ['AUTHENTICATED'] })
  securityState!: 'AUTHENTICATED';

  @ApiProperty({ enum: ['STANDARD', 'REMEMBERED_ADMIN', 'REMEMBERED_USER'] })
  lifetimeType!: 'STANDARD' | 'REMEMBERED_ADMIN' | 'REMEMBERED_USER';

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class CsrfResponseDto {
  @ApiProperty()
  csrfToken!: string;
}
