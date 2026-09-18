import { ApiProperty } from '@nestjs/swagger';

export class OrganizationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['INTERNAL', 'SUPPLIER'] })
  type!: 'INTERNAL' | 'SUPPLIER';
}

export class CurrentOrganizationResponseDto {
  @ApiProperty({ type: OrganizationDto })
  organization!: OrganizationDto;

  @ApiProperty()
  userId!: string;
}
