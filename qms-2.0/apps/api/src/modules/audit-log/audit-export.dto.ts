import { ApiProperty, OmitType } from '@nestjs/swagger';
import { AuditQueryDto } from './audit-query.dto.js';

export class AuditExportRequestDto extends OmitType(AuditQueryDto, ['pageSize', 'cursor'] as const) {}

export class AuditExportDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ maximum: 5000 }) rowCount!: number;
  @ApiProperty() downloadPath!: string;
}

export class AuditExportContentDto {
  @ApiProperty() filename!: string;
  @ApiProperty() contentType!: string;
  @ApiProperty() content!: string;
}
