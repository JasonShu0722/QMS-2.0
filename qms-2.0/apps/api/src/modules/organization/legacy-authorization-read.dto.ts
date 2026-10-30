import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { LegacyAuthorizationDirectSourceDto, LegacyAuthorizationLabelsDto, LegacyAuthorizationMappingDto, LegacyAuthorizationRoleDto, LegacyAuthorizationTargetDto } from './legacy-authorization-migration.dto.js';

export class LegacyAuthorizationPageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 }) @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset = 0;
}

export class LegacyAuthorizationHistoryQueryDto extends LegacyAuthorizationPageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_object, value) => value !== undefined) @IsUUID() roleId?: string;
}

export class LegacyAuthorizationSourcesQueryDto extends LegacyAuthorizationPageQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: '与 positionId 必须且只能指定一个。' }) @ValidateIf((_object, value) => value !== undefined) @IsUUID() userId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf((_object, value) => value !== undefined) @IsUUID() positionId?: string;
}

export class LegacyAuthorizationHistoryDto {
  @ApiProperty() archiveId!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() roleId!: string;
  @ApiProperty() actorUserId!: string;
  @ApiProperty() operation!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ enum: ['HISTORICAL'] }) state!: 'HISTORICAL';
  @ApiProperty({ type: LegacyAuthorizationRoleDto, nullable: true }) role!: LegacyAuthorizationRoleDto | null;
  @ApiProperty({ type: [LegacyAuthorizationDirectSourceDto] }) directSources!: LegacyAuthorizationDirectSourceDto[];
  @ApiProperty({ type: [LegacyAuthorizationMappingDto] }) mappedSources!: LegacyAuthorizationMappingDto[];
  @ApiProperty({ type: LegacyAuthorizationTargetDto, nullable: true }) target!: LegacyAuthorizationTargetDto | null;
  @ApiProperty({ type: Number, nullable: true }) retainedSourceCount!: number | null;
  @ApiProperty({ type: LegacyAuthorizationLabelsDto, nullable: true, description: '只含当时固定标签；旧事实没有标签时为null，不能以当前名称替代历史。' }) labels!: LegacyAuthorizationLabelsDto | null;
  @ApiProperty() labelsUnavailable!: boolean;
}

export class LegacyAuthorizationHistoryPageDto {
  @ApiProperty({ type: [LegacyAuthorizationHistoryDto] }) items!: LegacyAuthorizationHistoryDto[];
  @ApiProperty() total!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() offset!: number;
}

export class LegacyAuthorizationSourceDto {
  @ApiProperty() organizationId!: string;
  @ApiProperty({ type: String, nullable: true }) userId!: string | null;
  @ApiProperty({ type: String, nullable: true }) positionId!: string | null;
  @ApiProperty({ type: String, nullable: true }) assignmentId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) startedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) endedAt!: string | null;
  @ApiProperty({ enum: ['CURRENT', 'FUTURE', 'ENDED', 'UNAVAILABLE'] }) temporalState!: string;
  @ApiProperty({ enum: ['POSITION_CANONICAL', 'LEGACY_MAPPING', 'LEGACY_DIRECT', 'SYSTEM_INITIALIZATION'] }) kind!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: LegacyAuthorizationRoleDto }) role!: LegacyAuthorizationRoleDto;
}

export class LegacyAuthorizationSourcePageDto {
  @ApiProperty({ type: [LegacyAuthorizationSourceDto] }) items!: LegacyAuthorizationSourceDto[];
  @ApiProperty() total!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() offset!: number;
}

export class LegacyAuthorizationSourcesDto {
  @ApiProperty({ type: LegacyAuthorizationSourcePageDto }) currentSources!: LegacyAuthorizationSourcePageDto;
  @ApiProperty({ type: LegacyAuthorizationHistoryPageDto }) history!: LegacyAuthorizationHistoryPageDto;
  @ApiProperty({ type: LegacyAuthorizationLabelsDto }) labels!: LegacyAuthorizationLabelsDto;
}
