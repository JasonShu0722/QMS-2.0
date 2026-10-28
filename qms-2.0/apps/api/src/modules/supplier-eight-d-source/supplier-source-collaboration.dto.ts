import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';

export class SupplierSourceCollaborationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_, v) => v !== undefined) @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_, v) => v !== undefined) @IsUUID() cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50, description: 'Maximum candidate problems examined, not a total task count.' })
  @ValidateIf((_, v) => v !== undefined) @Transform(({ value }) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value)
  @IsInt() @Min(1) @Max(100) scanLimit?: number;
}

export class SupplierSourceCollaborationTaskDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['SOURCE_SQE_COLLABORATION'] }) kind!: 'SOURCE_SQE_COLLABORATION';
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ['PROCESS_LEDGER', 'CUSTOMER_LEDGER', 'NEW_PRODUCT_SELECTION'] }) sourceKind!: 'PROCESS_LEDGER' | 'CUSTOMER_LEDGER' | 'NEW_PRODUCT_SELECTION';
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
  @ApiProperty({ format: 'uuid' }) materialItemId!: string;
  @ApiProperty({ type: String, nullable: true, enum: ['UNREVIEWED', 'CONFIRMED_DEFECT', 'NOT_MATERIAL', 'NEGOTIATED', 'RETURN_ANALYSIS'] })
  verification!: 'UNREVIEWED' | 'CONFIRMED_DEFECT' | 'NOT_MATERIAL' | 'NEGOTIATED' | 'RETURN_ANALYSIS' | null;
  @ApiProperty({ type: String, nullable: true }) progress!: string | null;
  @ApiProperty({ type: String, nullable: true }) result!: string | null;
  @ApiProperty() link!: string;
}

export class SupplierSourceCollaborationPageDto {
  @ApiProperty({ type: [SupplierSourceCollaborationTaskDto] }) items!: SupplierSourceCollaborationTaskDto[];
  @ApiProperty() scannedCount!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) nextCursor!: string | null;
}
