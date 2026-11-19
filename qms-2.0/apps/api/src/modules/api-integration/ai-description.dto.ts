import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { AiDescriptionInputSnapshotDto } from '../../common/contracts/ai-description.dto.js';

export class AiDescriptionTaskQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() defectId!: string;
}

export class AiDescriptionTaskActionDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class AiDescriptionTaskDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) defectId!: string;
  @ApiProperty({ format: 'uuid' }) ruleId!: string;
  @ApiProperty() ruleVersion!: number;
  @ApiProperty() connectionVersion!: number;
  @ApiProperty({ enum: ['PENDING', 'PROCESSING', 'RETRY', 'FAILED', 'APPLIED', 'SUGGESTED', 'STALE'] }) status!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty() version!: number;
  @ApiProperty({ nullable: true, type: String }) result!: string | null;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class AiDescriptionTaskListDto {
  @ApiProperty({ type: [AiDescriptionTaskDto] }) items!: AiDescriptionTaskDto[];
}

export class AiIngestionPreviewDto {
  @ApiProperty() directDescription!: string;
  @ApiProperty({ type: [AiDescriptionInputSnapshotDto] }) inputFields!: AiDescriptionInputSnapshotDto[];
  @ApiProperty({ nullable: true, type: String }) aiDescription!: string | null;
  @ApiProperty({ enum: ['SUCCEEDED', 'FAILED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiPropertyOptional({ format: 'uuid' }) traceId?: string;
}
