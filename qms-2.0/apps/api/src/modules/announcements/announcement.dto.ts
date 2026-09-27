import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class AnnouncementScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}

export class AnnouncementInputDto extends AnnouncementScopeDto {
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) title!: string;
  @ApiProperty({ maxLength: 20000 }) @IsString() @MaxLength(20000) content!: string;
  @ApiProperty({ enum: ['NORMAL', 'IMPORTANT'] }) @IsIn(['NORMAL', 'IMPORTANT']) importance!: 'NORMAL' | 'IMPORTANT';
  @ApiProperty() @IsBoolean() mustRead!: boolean;
  @ApiProperty({ enum: ['ALL', 'SELECTED'] }) @IsIn(['ALL', 'SELECTED']) audience!: 'ALL' | 'SELECTED';
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 1000 }) @IsArray() @ArrayMaxSize(1000) @IsUUID('4', { each: true }) recipientUserIds!: string[];
}

export class UpdateAnnouncementDto extends AnnouncementInputDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class AnnouncementVersionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class MineAnnouncementsQueryDto extends AnnouncementScopeDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] }) @IsOptional() @IsIn(['true', 'false']) unreadOnly?: 'true' | 'false';
}

export class ManageAnnouncementsQueryDto extends AnnouncementScopeDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class AnnouncementResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() content!: string;
  @ApiProperty({ enum: ['NORMAL', 'IMPORTANT'] }) importance!: string;
  @ApiProperty() mustRead!: boolean;
  @ApiProperty({ enum: ['ALL', 'SELECTED'] }) audience!: string;
  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] }) status!: string;
  @ApiProperty() recipientCount!: number;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) publishedAt!: Date | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}

export class AnnouncementMineItemDto extends AnnouncementResponseDto {
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) readAt!: Date | null;
}

export class AnnouncementMinePageDto {
  @ApiProperty({ type: [AnnouncementMineItemDto] }) items!: AnnouncementMineItemDto[];
  @ApiProperty() unreadMustReadCount!: number;
}

export class AnnouncementManageItemDto extends AnnouncementResponseDto {
  @ApiProperty() readCount!: number;
  @ApiProperty({ type: [String], format: 'uuid' }) recipientUserIds!: string[];
}

export class AnnouncementManagePageDto {
  @ApiProperty({ type: [AnnouncementManageItemDto] }) items!: AnnouncementManageItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class AnnouncementReceiptDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) readAt!: Date | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) readSessionId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) readTraceId!: string | null;
}

export class AnnouncementReadDto {
  @ApiProperty({ format: 'uuid' }) announcementId!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ format: 'date-time' }) readAt!: Date;
}

export class AnnouncementAudienceUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() username!: string;
}

export class AnnouncementAudienceUsersDto {
  @ApiProperty({ type: [AnnouncementAudienceUserDto] }) items!: AnnouncementAudienceUserDto[];
  @ApiProperty() total!: number;
}
