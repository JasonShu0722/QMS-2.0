import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ minLength: 1, maxLength: 254 })
  @IsString()
  @Length(1, 254)
  identifier!: string;

  @ApiProperty({ minLength: 1, maxLength: 256 })
  @IsString()
  @Length(1, 256)
  password!: string;
}

export class LoginResponseDto {
  @ApiProperty({ enum: ['INTERNAL', 'SUPPLIER'] })
  accountType!: 'INTERNAL' | 'SUPPLIER';

  @ApiProperty({ enum: ['/app/workbench', '/supplier/inbox'] })
  landingPath!: '/app/workbench' | '/supplier/inbox';
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
}

export class CsrfResponseDto {
  @ApiProperty()
  csrfToken!: string;
}
