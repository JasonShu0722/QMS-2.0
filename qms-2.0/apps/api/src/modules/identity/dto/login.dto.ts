import { IsString, Length } from 'class-validator';

export class LoginDto {
  @IsString()
  @Length(1, 254)
  identifier!: string;

  @IsString()
  @Length(1, 256)
  password!: string;
}

export interface LoginResponseDto {
  accountType: 'INTERNAL' | 'SUPPLIER';
  landingPath: '/app/workbench' | '/supplier/inbox';
}

export interface SessionResponseDto {
  user: {
    id: string;
    organizationId: string;
    accountType: 'INTERNAL' | 'SUPPLIER';
  };
}
