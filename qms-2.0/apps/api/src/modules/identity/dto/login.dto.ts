export class LoginDto {
  identifier!: string;
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
