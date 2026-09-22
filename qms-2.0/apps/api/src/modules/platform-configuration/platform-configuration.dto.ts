import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

export const NOTIFICATION_KINDS = ['TASK_ASSIGNED', 'TASK_REMINDER', 'TASK_ESCALATED'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export class ConfigurationScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}

export class PlatformSettingsDto {
  @ApiProperty({ enum: ['zh-CN', 'en-US'] }) notificationLocale!: 'zh-CN' | 'en-US';
  @ApiProperty({ minimum: 5, maximum: 10080 }) exportRetentionMinutes!: number;
  @ApiProperty() version!: number;
}

export class UpdatePlatformSettingsDto {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) expectedVersion!: number;
  @ApiProperty({ enum: ['zh-CN', 'en-US'] }) @IsIn(['zh-CN', 'en-US']) notificationLocale!: 'zh-CN' | 'en-US';
  @ApiProperty({ minimum: 5, maximum: 10080 }) @IsInt() @Min(5) @Max(10080) exportRetentionMinutes!: number;
}

export class NotificationRuleDto {
  @ApiProperty({ enum: NOTIFICATION_KINDS }) kind!: NotificationKind;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() subjectTemplate!: string;
  @ApiProperty() bodyTemplate!: string;
  @ApiProperty() version!: number;
}

export class UpdateNotificationRuleDto {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) expectedVersion!: number;
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty({ maxLength: 255 }) @IsString() @Length(1, 255) subjectTemplate!: string;
  @ApiProperty({ maxLength: 2000 }) @IsString() @Length(1, 2000) bodyTemplate!: string;
}

export class PositionCategoryDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) status!: 'ACTIVE' | 'DISABLED';
  @ApiProperty() sortOrder!: number;
  @ApiProperty() version!: number;
}

export class CreatePositionCategoryDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @Length(1, 64) @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/) code!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @Length(1, 200) @Matches(/\S/) name!: string;
  @ApiProperty({ minimum: 0, maximum: 10000 }) @IsInt() @Min(0) @Max(10000) sortOrder!: number;
}

export class UpdatePositionCategoryDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiPropertyOptional({ maxLength: 200 }) @ValidateIf((_object, value) => value !== undefined) @IsString() @Length(1, 200) @Matches(/\S/) name?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] }) @ValidateIf((_object, value) => value !== undefined) @IsIn(['ACTIVE', 'DISABLED']) status?: 'ACTIVE' | 'DISABLED';
  @ApiPropertyOptional({ minimum: 0, maximum: 10000 }) @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}
