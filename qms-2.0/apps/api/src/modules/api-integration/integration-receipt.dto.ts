import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { IntegrationPageQueryDto } from './integration-admin.dto.js';

export const INTEGRATION_ATTEMPT_OUTCOMES = ['RECEIVED', 'DUPLICATE', 'REJECTED', 'FAILED', 'UNKNOWN'] as const;
export class IntegrationReceiptQueryDto extends IntegrationPageQueryDto {
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() endpointId?: string;
  @ApiPropertyOptional({ maxLength: 64 }) @IsOptional() @IsString() @MaxLength(64) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/) sourceCode?: string;
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() @MaxLength(128) @Matches(/^[A-Za-z0-9._:-]{8,128}$/) messageId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() receiptId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() traceId?: string;
  @ApiPropertyOptional({ enum: INTEGRATION_ATTEMPT_OUTCOMES }) @IsOptional() @IsIn(INTEGRATION_ATTEMPT_OUTCOMES) outcome?: (typeof INTEGRATION_ATTEMPT_OUTCOMES)[number];
}
export class DeleteIntegrationReceiptsDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ type: [String], minItems: 1, maxItems: 100, format: 'uuid' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('all', { each: true }) receiptIds!: string[];
}
export class IntegrationReceiptDeleteResultDto {
  @ApiProperty() deletedCount!: number;
  @ApiProperty({ type: [String], format: 'uuid' }) receiptIds!: string[];
}
export class IntegrationReceiptEndpointQueryDto extends IntegrationPageQueryDto {
  @ApiPropertyOptional({ maxLength: 120 }) @IsOptional() @IsString() @MaxLength(120) search?: string;
}
export class IntegrationReceiptEndpointDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
}
export class IntegrationReceiptEndpointPageDto {
  @ApiProperty({ type: [IntegrationReceiptEndpointDto] }) items!: IntegrationReceiptEndpointDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class IntegrationReceiptDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) endpointId!: string;
  @ApiProperty() endpointName!: string;
  @ApiProperty() endpointCode!: string;
  @ApiProperty({ format: 'uuid' }) credentialId!: string;
  @ApiProperty() messageId!: string;
  @ApiProperty() sourceCode!: string;
  @ApiProperty() sourceName!: string;
  @ApiProperty() configurationVersion!: number;
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;
  @ApiProperty({ format: 'date-time' }) bodyExpiresAt!: string;
  @ApiProperty({ format: 'date-time' }) metadataExpiresAt!: string;
  @ApiProperty() bodyAvailable!: boolean;
  @ApiProperty() payloadBytes!: number;
}
export class IntegrationReceiptPageDto {
  @ApiProperty({ type: [IntegrationReceiptDto] }) items!: IntegrationReceiptDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty({ format: 'date-time' }) from!: string;
  @ApiProperty({ format: 'date-time' }) to!: string;
}
export class IntegrationAttemptDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) traceId!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) endpointId!: string;
  @ApiProperty() endpointName!: string;
  @ApiProperty() endpointCode!: string;
  @ApiProperty({ format: 'uuid' }) credentialId!: string;
  @ApiPropertyOptional() messageId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) receiptId?: string;
  @ApiProperty() configurationVersion!: number;
  @ApiProperty() returnReceipt!: boolean;
  @ApiProperty() statusCode!: number;
  @ApiProperty({ enum: INTEGRATION_ATTEMPT_OUTCOMES }) outcome!: (typeof INTEGRATION_ATTEMPT_OUTCOMES)[number];
  @ApiPropertyOptional() reasonCode?: string;
  @ApiProperty() durationMs!: number;
  @ApiProperty({ format: 'date-time' }) observedAt!: string;
}
export class IntegrationAttemptPageDto {
  @ApiProperty({ type: [IntegrationAttemptDto] }) items!: IntegrationAttemptDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty({ format: 'date-time' }) from!: string;
  @ApiProperty({ format: 'date-time' }) to!: string;
  @ApiProperty({ enum: ['UNKNOWN', 'UNAVAILABLE'] }) collectionStatus!: 'UNKNOWN' | 'UNAVAILABLE';
}
export class IntegrationPayloadDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() text!: string;
  @ApiProperty({ format: 'date-time' }) bodyExpiresAt!: string;
}
export class IntegrationOperationDto {
  @ApiProperty() usedBodyBytes!: number;
  @ApiProperty() capacityBytes!: number;
  @ApiProperty() receiptCount!: number;
  @ApiProperty() receiptLimit!: number;
  @ApiProperty({ enum: ['UNKNOWN', 'UNAVAILABLE'] }) requestCollection!: 'UNKNOWN' | 'UNAVAILABLE';
  @ApiPropertyOptional({ format: 'date-time' }) lastCleanupSucceededAt?: string;
  @ApiPropertyOptional({ format: 'date-time' }) lastCleanupFailedAt?: string;
}
