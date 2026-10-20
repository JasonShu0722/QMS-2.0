import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsIn, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ESignatureScopeDto { @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string; }
export class RegisterESignatureDto extends ESignatureScopeDto {
  @ApiProperty({ maxLength: 120 }) @IsString() @MaxLength(120) label!: string;
  @ApiProperty({ description: '签名原文或签名图像编码，仅用于即时生成指纹，不会持久化' }) @IsString() @MaxLength(100000) signatureData!: string;
}
export class RevokeESignatureDto extends ESignatureScopeDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; }
export class ESignatureQueryDto extends ESignatureScopeDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'REVOKED'] }) @IsOptional() @IsIn(['ACTIVE', 'REVOKED']) status?: 'ACTIVE' | 'REVOKED';
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
export class SignApprovalDto extends ESignatureScopeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() signatureId!: string;
  @ApiProperty({ pattern: '^[A-Z][A-Z0-9_]{1,63}$' }) @IsString() @MaxLength(64) resourceType!: string;
  @ApiProperty({ maxLength: 128 }) @IsString() @MaxLength(128) resourceId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) resourceVersion!: number;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class ApprovalSignatureQueryDto extends ESignatureScopeDto {
  @ApiProperty({ pattern: '^[A-Z][A-Z0-9_]{1,63}$' }) @IsString() @MaxLength(64) resourceType!: string;
  @ApiProperty({ maxLength: 128 }) @IsString() @MaxLength(128) resourceId!: string;
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) resourceVersion!: number;
}
export class ESignatureDto {
  @ApiProperty({ format: 'uuid' }) id!: string; @ApiProperty({ format: 'uuid' }) organizationId!: string; @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() label!: string; @ApiProperty() fingerprint!: string; @ApiProperty({ enum: ['ACTIVE', 'REVOKED'] }) status!: string; @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string; @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) revokedAt!: string | null;
}
export class ESignaturePageDto { @ApiProperty({ type: [ESignatureDto] }) items!: ESignatureDto[]; @ApiProperty() total!: number; @ApiProperty() page!: number; @ApiProperty() pageSize!: number; }
export class ESignatureSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: ['ACTIVE', 'REVOKED'] }) status!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) revokedAt!: string | null;
}
export class ESignatureSummaryQueryDto {}
export class ApprovalSignatureDto {
  @ApiProperty({ format: 'uuid' }) id!: string; @ApiProperty({ format: 'uuid' }) organizationId!: string; @ApiProperty({ format: 'uuid' }) signatureId!: string; @ApiProperty({ format: 'uuid' }) signerUserId!: string;
  @ApiProperty() resourceType!: string; @ApiProperty() resourceId!: string; @ApiProperty() resourceVersion!: number; @ApiProperty() signatureFingerprint!: string; @ApiProperty() signedDigest!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) note!: string | null; @ApiProperty({ format: 'date-time' }) signedAt!: string;
}
