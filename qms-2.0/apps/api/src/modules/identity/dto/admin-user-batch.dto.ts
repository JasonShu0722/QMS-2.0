import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsObject, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TemporaryPasswordDto } from './password-change-challenge.dto.js';

export class AdminUserBatchRowDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  rowNumber!: number;

  @ApiProperty()
  @Allow()
  username!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Allow()
  email?: string | null;

  @ApiProperty({ type: String, description: 'Raw account type; unsupported values produce a per-row error.' })
  @Allow()
  accountType!: string;

  @ApiPropertyOptional({ type: [String], description: 'Raw positions; invalid or missing internal positions produce a per-row error.' })
  @Allow()
  positionIds?: string[];

  @ApiPropertyOptional({ type: String })
  @Allow()
  authorizationBaseline?: string;
}

export class CreateAdminUserBatchDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ type: [AdminUserBatchRowDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => AdminUserBatchRowDto)
  rows!: AdminUserBatchRowDto[];
}

export class AdminUserBatchResultRowDto {
  @ApiProperty()
  rowNumber!: number;

  @ApiProperty()
  username!: string;

  @ApiProperty({ enum: ['SUCCESS', 'ERROR'] })
  status!: 'SUCCESS' | 'ERROR';

  @ApiPropertyOptional()
  code?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  userId?: string;

  @ApiPropertyOptional()
  credentialVersion?: number;

  @ApiPropertyOptional({ type: TemporaryPasswordDto })
  temporaryPassword?: TemporaryPasswordDto;
}

export class AdminUserBatchResultDto {
  @ApiProperty({ format: 'uuid' })
  batchId!: string;

  @ApiProperty({ type: [AdminUserBatchResultRowDto] })
  rows!: AdminUserBatchResultRowDto[];
}

export class AdminUserBatchPreviewRowDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  @IsInt() @Min(1) @Max(2147483647)
  rowNumber!: number;

  @ApiProperty()
  @Allow()
  username!: string;

  @ApiProperty()
  @Allow()
  fullName!: string;

  @ApiProperty({ type: String, description: 'INTERNAL or SUPPLIER. Invalid values are reported per row.' })
  @Allow()
  accountType!: string;

  @ApiProperty()
  @Allow()
  organizationCode!: string;

  @ApiProperty({ writeOnly: true, format: 'password', description: 'Initial password. Never included in responses.' })
  @Allow()
  password!: string;
}

export class CreateAdminUserBatchPreviewDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Management scope. Defaults to the actor’s home organization.' })
  @IsOptional() @IsUUID()
  organizationId?: string;

  @ApiProperty({ type: [AdminUserBatchPreviewRowDto], minItems: 1, maxItems: 100 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true }) @Type(() => AdminUserBatchPreviewRowDto)
  rows!: AdminUserBatchPreviewRowDto[];
}

export class AdminUserBatchPreviewResultRowDto {
  @ApiProperty()
  rowNumber!: number;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  accountType!: string;

  @ApiProperty()
  organizationCode!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  organizationId?: string;

  @ApiPropertyOptional()
  organizationName?: string;

  @ApiProperty({ enum: ['READY', 'SKIPPED'] })
  status!: 'READY' | 'SKIPPED';

  @ApiPropertyOptional()
  code?: string;

  @ApiPropertyOptional()
  message?: string;
}

export class AdminUserBatchPreviewResultDto {
  @ApiProperty({ format: 'uuid' })
  previewId!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ type: [AdminUserBatchPreviewResultRowDto] })
  rows!: AdminUserBatchPreviewResultRowDto[];
}

export class AdminUserBatchConfirmDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Same management scope as preview.' })
  @IsOptional() @IsUUID()
  organizationId?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  previewId!: string;
}

export class AdminUserBatchConfirmResultRowDto {
  @ApiProperty()
  rowNumber!: number;

  @ApiProperty()
  username!: string;

  @ApiProperty({ enum: ['SUCCESS', 'SKIPPED', 'FAILED'] })
  status!: 'SUCCESS' | 'SKIPPED' | 'FAILED';

  @ApiPropertyOptional()
  code?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  userId?: string;

  @ApiPropertyOptional()
  configurationRequired?: boolean;
}

export class AdminUserBatchConfirmResultDto {
  @ApiProperty({ format: 'uuid' })
  batchId!: string;

  @ApiProperty({ type: [AdminUserBatchConfirmResultRowDto] })
  rows!: AdminUserBatchConfirmResultRowDto[];
}
