import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';
import { FileEvidenceDto } from '../file-management/file.dto.js';

export class SupplierDisclosurePreviewDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) expectedRowVersion!: number;
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 100 }) @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID('4', { each: true }) selectedFileIds!: string[];
}
export class SupplierDisclosureReleaseDto extends SupplierDisclosurePreviewDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') previewToken!: string;
  @ApiProperty({ enum: [true] }) @IsIn([true]) confirmed!: true;
}
export class SupplierDisclosureFactsDto {
  @ApiProperty() title!: string;
  @ApiProperty() materialCode!: string;
  @ApiPropertyOptional({ enum: ['STRUCTURE', 'ELECTRONIC'] }) materialCategory?: string;
  @ApiProperty() defectDescription!: string;
  @ApiProperty({ minimum: 1 }) defectQuantity!: number;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }) severity!: string;
  @ApiProperty() reportNumber!: string;
}
export class SupplierDisclosurePreviewResultDto {
  @ApiProperty({ format: 'uuid' }) previewToken!: string;
  @ApiProperty({ format: 'uuid' }) supplierOrganizationId!: string;
  @ApiProperty() supplierName!: string;
  @ApiProperty() rowVersion!: number;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: SupplierDisclosureFactsDto }) publicFacts!: SupplierDisclosureFactsDto;
  @ApiProperty({ type: [String] }) selectedFileIds!: string[];
  @ApiProperty({ type: [FileEvidenceDto] }) attachments!: FileEvidenceDto[];
  @ApiProperty({ type: [String] }) warnings!: string[];
}
export class SupplierDisclosureReleaseResultDto {
  @ApiProperty({ format: 'uuid' }) publicationId!: string;
  @ApiProperty({ format: 'date-time' }) releasedAt!: string;
  @ApiProperty() rowVersion!: number;
  @ApiProperty() contentVersion!: number;
  @ApiProperty({ minimum: 1 }) eligibleRecipientCount!: number;
  @ApiProperty({ enum: ['PENDING_PROJECTION'], description: '通知事件已入队，不表示供应商已经收到或签收' }) notificationState!: 'PENDING_PROJECTION';
}
