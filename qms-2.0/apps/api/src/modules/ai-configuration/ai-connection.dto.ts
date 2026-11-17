import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { aiConnectionProtocols, type AiConnectionProtocol, type AiFailureCode } from './ai-connection.policy.js';

export class AiConnectionSettingsDto {
  @ApiProperty({ maxLength: 120 }) @IsString() @Length(1, 120) name!: string;
  @ApiProperty({ maxLength: 500 }) @IsString() @Length(1, 500) baseUrl!: string;
  @ApiPropertyOptional({ enum: aiConnectionProtocols, default: 'OPENAI_CHAT_COMPLETIONS' })
  @ValidateIf((_object, value) => value !== undefined) @IsIn(aiConnectionProtocols) protocol?: AiConnectionProtocol;
  @ApiProperty({ type: [String], minItems: 1, maxItems: 30, uniqueItems: true })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ArrayUnique() @IsString({ each: true }) @Length(1, 120, { each: true }) models!: string[];
  @ApiProperty({ maxLength: 120 }) @IsString() @Length(1, 120) defaultModel!: string;
  @ApiProperty() @IsBoolean() enabled!: boolean;
}
export class CreateAiConnectionDto extends AiConnectionSettingsDto {
  @ApiProperty({ writeOnly: true, minLength: 1, maxLength: 4096 }) @IsString() @Length(1, 4096) @Matches(/^[\x21-\x7e]+$/) apiKey!: string;
}
export class AiConnectionVersionDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}
export class UpdateAiConnectionDto extends AiConnectionSettingsDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @ApiPropertyOptional({ writeOnly: true, maxLength: 4096, description: '留空保持已保存密钥；清除使用独立操作。' })
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Length(0, 4096) @Matches(/^[\x21-\x7e]*$/) apiKey?: string;
}
export class AiConnectionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() baseUrl!: string;
  @ApiProperty({ enum: aiConnectionProtocols }) protocol!: AiConnectionProtocol;
  @ApiProperty({ type: [String] }) models!: string[];
  @ApiProperty() defaultModel!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() hasKey!: boolean;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class AiConnectionTestDto {
  @ApiProperty({ format: 'uuid' }) connectionId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() model!: string;
  @ApiProperty({ enum: ['SUCCESS', 'FAILED'] }) status!: 'SUCCESS' | 'FAILED';
  @ApiProperty() code!: 'AI_CONNECTION_OK' | AiFailureCode;
}
