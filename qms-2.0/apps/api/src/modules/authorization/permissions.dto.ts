import { ApiProperty } from '@nestjs/swagger';

export class PermissionsResponseDto {
  @ApiProperty()
  organizationId!: string;

  @ApiProperty({ type: [String] })
  permissions!: string[];
}
