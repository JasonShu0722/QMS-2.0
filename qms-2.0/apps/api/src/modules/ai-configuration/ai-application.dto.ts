import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { AiConnectionVersionDto } from './ai-connection.dto.js';

export class AiApplicationVariableDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @Matches(/^[A-Za-z][A-Za-z0-9_]{0,63}$/) variable!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @Length(0, 100) label!: string;
}
export class AiApplicationOutputDto {
  @ApiProperty({ enum: ['TEXT', 'JSON'] }) @IsIn(['TEXT', 'JSON']) mode!: 'TEXT' | 'JSON';
  @ApiProperty({ maxLength: 100 }) @IsString() @Length(1, 100) field!: string;
  @ApiProperty({ enum: ['description'] }) @IsIn(['description']) target!: 'description';
}
export class AiApplicationSettingsDto {
  @ApiProperty({ maxLength: 120 }) @IsString() @Length(1, 120) name!: string;
  @ApiProperty({ enum: ['PROCESS_QUALITY'] }) @IsIn(['PROCESS_QUALITY']) domain!: 'PROCESS_QUALITY';
  @ApiProperty({ enum: ['PROCESS_DEFECT_DESCRIPTION'] }) @IsIn(['PROCESS_DEFECT_DESCRIPTION']) scene!: 'PROCESS_DEFECT_DESCRIPTION';
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty({ type: [AiApplicationVariableDto], minItems: 1, maxItems: 20 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => AiApplicationVariableDto) variables!: AiApplicationVariableDto[];
  @ApiProperty({ format: 'uuid' }) @IsUUID() connectionId!: string;
  @ApiProperty({ maxLength: 120 }) @IsString() @Length(1, 120) model!: string;
  @ApiProperty({ maxLength: 4000 }) @IsString() @Length(1, 4000) prompt!: string;
  @ApiProperty({ type: AiApplicationOutputDto }) @ValidateNested() @Type(() => AiApplicationOutputDto) output!: AiApplicationOutputDto;
  @ApiProperty({ enum: ['DIRECT'] }) @IsIn(['DIRECT']) fallback!: 'DIRECT';
}
export class UpdateAiApplicationDto extends AiApplicationSettingsDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}
export class AiApplicationDto extends AiApplicationSettingsDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: Number, nullable: true }) publishedVersion!: number | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class AiApplicationRevisionDto {
  @ApiProperty({ format: 'uuid' }) applicationId!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() publishedVersion!: number;
  @ApiProperty({ type: AiApplicationSettingsDto }) configuration!: AiApplicationSettingsDto;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class AiApplicationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 10000, default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
export class AiApplicationPageDto {
  @ApiProperty({ type: [AiApplicationDto] }) items!: AiApplicationDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class AiApplicationSampleDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @Matches(/^[A-Za-z][A-Za-z0-9_]{0,63}$/) variable!: string;
  @ApiProperty({ maxLength: 16000 }) @IsString() @Length(0, 16000) value!: string;
}
export class TestAiApplicationDto extends AiConnectionVersionDto {
  @ApiProperty({ type: [AiApplicationSampleDto], minItems: 1, maxItems: 20 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => AiApplicationSampleDto) samples!: AiApplicationSampleDto[];
}
export class AiApplicationTestResultDto {
  @ApiProperty({ format: 'uuid' }) applicationId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['SUCCESS', 'FAILED'] }) status!: 'SUCCESS' | 'FAILED';
  @ApiProperty() code!: string;
  @ApiProperty({ type: String, nullable: true }) text!: string | null;
}
export class AiApplicationInvocationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ enum: ['APPLICATION_TEST', 'RUNTIME_TASK'] }) source!: 'APPLICATION_TEST' | 'RUNTIME_TASK';
  @ApiProperty({ type: Number, nullable: true, description: 'Draft version for tests, published version for runtime tasks.' }) applicationVersion!: number | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) connectionId!: string | null;
  @ApiProperty({ type: Number, nullable: true }) connectionVersion!: number | null;
  @ApiProperty({ type: String, nullable: true }) model!: string | null;
  @ApiProperty({ type: String, enum: ['TEXT', 'JSON'], nullable: true }) outputMode!: AiApplicationOutputDto['mode'] | null;
  @ApiProperty({ enum: ['SUCCESS', 'PENDING', 'PROCESSING', 'RETRY', 'FAILED', 'APPLIED', 'SUGGESTED', 'STALE'] })
  status!: 'SUCCESS' | 'PENDING' | 'PROCESSING' | 'RETRY' | 'FAILED' | 'APPLIED' | 'SUGGESTED' | 'STALE';
  @ApiProperty({ type: Number, nullable: true, description: 'Current task attempt counter, which resets on manual retry. Unavailable for tests.' }) attempts!: number | null;
  @ApiProperty({ type: String, nullable: true }) errorCode!: string | null;
  @ApiProperty({ format: 'date-time', description: 'Audit event time for tests, latest update time for runtime tasks.' }) recordedAt!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) taskId!: string | null;
  @ApiProperty({ type: String, nullable: true }) traceId!: string | null;
}
export class AiApplicationInvocationPageDto {
  @ApiProperty({ type: [AiApplicationInvocationDto] }) items!: AiApplicationInvocationDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
