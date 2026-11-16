import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AiDescriptionInputSnapshotDto {
  @ApiProperty() path!: string;
  @ApiProperty() label!: string;
  @ApiPropertyOptional() variable?: string;
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }], nullable: true }) value!: string | number | boolean | null;
}
