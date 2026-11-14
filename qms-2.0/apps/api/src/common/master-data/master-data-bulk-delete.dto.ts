import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export class MasterDataDeleteRecordDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}

export class MasterDataBulkDeleteDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ type: [MasterDataDeleteRecordDto], minItems: 1, maxItems: 1000 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000)
  @ArrayUnique((record: MasterDataDeleteRecordDto | null) => typeof record?.id === 'string' ? record.id.toLowerCase() : record?.id)
  @ValidateNested({ each: true }) @Type(() => MasterDataDeleteRecordDto) records!: MasterDataDeleteRecordDto[];
}

export class MasterDataBulkDeleteItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['DELETED', 'REFERENCED', 'CONFLICT', 'NOT_FOUND'] }) status!: 'DELETED' | 'REFERENCED' | 'CONFLICT' | 'NOT_FOUND';
}

export class MasterDataBulkDeleteResultDto {
  @ApiProperty({ type: [MasterDataBulkDeleteItemDto] }) items!: MasterDataBulkDeleteItemDto[];
  @ApiProperty() deleted!: number;
  @ApiProperty() referenced!: number;
  @ApiProperty() conflicted!: number;
  @ApiProperty() notFound!: number;
}
