import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';
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
