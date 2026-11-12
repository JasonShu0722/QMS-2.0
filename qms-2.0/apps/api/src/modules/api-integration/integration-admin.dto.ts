import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class IntegrationScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}
export class IntegrationConnectionQueryDto extends IntegrationScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() credentialId?: string;
}
export class IntegrationPageQueryDto extends IntegrationScopeDto {
  @ApiPropertyOptional({ minimum: 1, default: 1, maximum: 10000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
export class CreateIntegrationEndpointDto extends IntegrationScopeDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/) code!: string;
  @ApiProperty({ maxLength: 120 }) @IsString() @MaxLength(120) name!: string;
  @ApiProperty({ maxLength: 64 }) @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/) sourceCode!: string;
  @ApiProperty({ maxLength: 120 }) @IsString() @MaxLength(120) sourceName!: string;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() returnReceipt?: boolean;
  @ApiPropertyOptional({ minimum: 1, maximum: 1048576, default: 1048576 }) @IsOptional() @IsInt() @Min(1) @Max(1048576) maxBodyBytes?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 300, default: 60 }) @IsOptional() @IsInt() @Min(1) @Max(300) ratePerMinute?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 30, default: 7 }) @IsOptional() @IsInt() @Min(1) @Max(30) bodyRetentionDays?: number;
  @ApiPropertyOptional({ minimum: 16777216, maximum: 5368709120, default: 268435456 }) @IsOptional() @IsInt() @Min(16777216) @Max(5368709120) capacityBytes?: number;
  @ApiPropertyOptional({ type: [String], maxItems: 32 }) @IsOptional() @IsArray() @ArrayMaxSize(32) @IsString({ each: true }) @MaxLength(64, { each: true }) allowedIps?: string[];
}
export class UpdateIntegrationEndpointDto extends IntegrationScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiPropertyOptional({ maxLength: 120 }) @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'ENABLED', 'DISABLED'] }) @IsOptional() @IsIn(['DRAFT', 'ENABLED', 'DISABLED']) status?: 'DRAFT' | 'ENABLED' | 'DISABLED';
  @ApiPropertyOptional() @IsOptional() @IsBoolean() returnReceipt?: boolean;
  @ApiPropertyOptional({ minimum: 1, maximum: 1048576 }) @IsOptional() @IsInt() @Min(1) @Max(1048576) maxBodyBytes?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 300 }) @IsOptional() @IsInt() @Min(1) @Max(300) ratePerMinute?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 30 }) @IsOptional() @IsInt() @Min(1) @Max(30) bodyRetentionDays?: number;
  @ApiPropertyOptional({ minimum: 16777216, maximum: 5368709120 }) @IsOptional() @IsInt() @Min(16777216) @Max(5368709120) capacityBytes?: number;
  @ApiPropertyOptional({ type: [String], maxItems: 32 }) @IsOptional() @IsArray() @ArrayMaxSize(32) @IsString({ each: true }) @MaxLength(64, { each: true }) allowedIps?: string[];
}
export class DeleteIntegrationEndpointDto extends IntegrationScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}
export class CreateIntegrationCredentialDto extends IntegrationScopeDto {
  @ApiProperty({ maxLength: 120 }) @IsString() @MaxLength(120) name!: string;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 365, default: 90, description: 'null 表示永久有效。' }) @IsOptional() @IsInt() @Min(1) @Max(365) validityDays?: number | null;
}
export class IntegrationEndpointDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() sourceCode!: string;
  @ApiProperty() sourceName!: string;
  @ApiProperty({ enum: ['DRAFT', 'ENABLED', 'DISABLED'] }) status!: 'DRAFT' | 'ENABLED' | 'DISABLED';
  @ApiProperty() version!: number;
  @ApiProperty() returnReceipt!: boolean;
  @ApiProperty() maxBodyBytes!: number;
  @ApiProperty() ratePerMinute!: number;
  @ApiProperty() bodyRetentionDays!: number;
  @ApiProperty() capacityBytes!: number;
  @ApiProperty() usedBodyBytes!: number;
  @ApiProperty({ type: [String] }) allowedIps!: string[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty() publicUrl!: string;
}
export class IntegrationEndpointPageDto {
  @ApiProperty({ type: [IntegrationEndpointDto] }) items!: IntegrationEndpointDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class IntegrationConnectionDto {
  @ApiProperty({ type: IntegrationEndpointDto }) endpoint!: IntegrationEndpointDto;
  @ApiProperty({ format: 'uuid' }) credentialId!: string;
  @ApiProperty() credentialName!: string;
  @ApiProperty() authorization!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) expiresAt!: string | null;
}
export class IntegrationCredentialDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) endpointId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) createdById!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) expiresAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) revokedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiPropertyOptional({ description: '首次创建响应中的凭据值，幂等回放不包含此字段。' }) secret?: string;
}
export class IntegrationCredentialPageDto {
  @ApiProperty({ type: [IntegrationCredentialDto] }) items!: IntegrationCredentialDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
