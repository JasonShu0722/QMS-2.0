import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Length, ValidateIf } from 'class-validator';

export class CompletePasswordChangeDto {
  @ApiProperty({ minLength: 12, maxLength: 256 })
  @IsString()
  @Length(12, 256)
  newPassword!: string;
}

export class ResetTemporaryPasswordDto {
  @ApiPropertyOptional({ minLength: 12, maxLength: 256 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(12, 256)
  temporaryPassword?: string;
}

export class TemporaryPasswordDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ enum: ['AVAILABLE', 'EXPIRED', 'UNAVAILABLE'] })
  status!: 'AVAILABLE' | 'EXPIRED' | 'UNAVAILABLE';

  @ApiPropertyOptional()
  credentialVersion?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  expiresAt?: string;

  @ApiPropertyOptional()
  temporaryPassword?: string;
}
