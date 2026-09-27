import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class IncomingScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}

export class IncomingItemDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) order!: number;
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) name!: string;
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) measuredValue?: string;
  @ApiProperty({ enum: ['PASS', 'NG', 'NA'] }) @IsIn(['PASS', 'NG', 'NA']) result!: 'PASS' | 'NG' | 'NA';
}

export class CreateIncomingInspectionDto extends IncomingScopeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() profileId!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) materialCode!: string;
  @ApiProperty({ maxLength: 160 }) @IsString() @MaxLength(160) incomingBatch!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) receivedQuantity!: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) sampledQuantity!: number;
  @ApiPropertyOptional({ enum: ['MANUAL', 'MES'], default: 'MANUAL' }) @IsOptional() @IsIn(['MANUAL', 'MES']) sourceSystem: 'MANUAL' | 'MES' = 'MANUAL';
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) externalRecordKey?: string;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) externalBatchKey?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() observedAt?: Date;
  @ApiPropertyOptional({ type: [IncomingItemDto], maxItems: 200 }) @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => IncomingItemDto) items?: IncomingItemDto[];
}

export class CompleteIncomingInspectionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ enum: ['PASS', 'NG'] }) @IsIn(['PASS', 'NG']) conclusion!: 'PASS' | 'NG';
}

export class CorrectIncomingInspectionDto extends CompleteIncomingInspectionDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 }) @IsString() @MaxLength(2000) reason!: string;
}

export class LinkIncomingProblemDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ maxLength: 500 }) @IsString() @MaxLength(500) title!: string;
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) defectDescription!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) defectQuantity!: number;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }) @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) severity!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  @ApiProperty({ enum: ['BRIEF', 'EIGHT_D'] }) @IsIn(['BRIEF', 'EIGHT_D']) responseForm!: 'BRIEF' | 'EIGHT_D';
  @ApiProperty({ enum: ['SUPPLIER', 'INTERNAL'] }) @IsIn(['SUPPLIER', 'INTERNAL']) replyMode!: 'SUPPLIER' | 'INTERNAL';
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() internalResponderId?: string;
}

export class AttachIncomingPhotoDto extends IncomingScopeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() fileId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class IncomingQueryDto extends IncomingScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() profileId?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) materialCode?: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'COMPLETED', 'CORRECTED'] }) @IsOptional() @IsIn(['DRAFT', 'COMPLETED', 'CORRECTED']) status?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
