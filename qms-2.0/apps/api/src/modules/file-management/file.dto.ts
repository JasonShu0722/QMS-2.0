import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsMimeType, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

export class FileResourceDto {
  @ApiProperty({ maxLength: 100 }) @IsString() @Matches(/^[A-Za-z][A-Za-z0-9._:-]{0,99}$/)
  resourceType!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID()
  resourceId!: string;
}

export class InitializeFileUploadDto extends FileResourceDto {
  @ApiProperty({ maxLength: 255 }) @IsString() @Length(1, 255) @Matches(/^[^\x00-\x1f\x7f\\/]+$/)
  originalName!: string;
  @ApiProperty() @IsMimeType() @Length(1, 150)
  contentType!: string;
  @ApiProperty({ minimum: 1, maximum: 26214400 }) @IsInt() @Min(1) @Max(26214400)
  sizeBytes!: number;
  @ApiProperty({ pattern: '^[0-9a-f]{64}$' }) @Matches(/^[0-9a-f]{64}$/)
  sha256!: string;
}

export class FileMutationDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647)
  expectedVersion!: number;
}

export class FileDto extends FileResourceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() originalName!: string;
  @ApiProperty() contentType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty() sha256!: string;
  @ApiProperty({ enum: ['QUARANTINED', 'AVAILABLE', 'DELETED'] }) status!: string;
  @ApiProperty({ enum: ['WAITING_UPLOAD', 'PENDING', 'CLEAN', 'REJECTED', 'ERROR', 'EXPIRED'] }) scanStatus!: string;
  @ApiProperty({ type: String, nullable: true }) scanReason!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) uploadExpiresAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) scannedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) deletedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) retainUntil!: string;
}

export class FileUploadDto {
  @ApiProperty({ type: FileDto }) file!: FileDto;
  @ApiProperty() uploadUrl!: string;
  @ApiProperty({ type: Object, additionalProperties: { type: 'string' } }) headers!: Record<string, string>;
  @ApiProperty({ format: 'date-time' }) urlExpiresAt!: string;
}

export class FileDownloadDto {
  @ApiProperty() url!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

export class FileDownloadRequestDto {}

export class FileEvidenceDto extends FileDto {
  @ApiProperty() downloadable!: boolean;
}
