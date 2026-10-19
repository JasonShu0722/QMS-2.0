import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class AuditQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional() @IsString() @MaxLength(150)
  action?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional() @IsString() @MaxLength(100)
  resourceType?: string;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional() @IsString() @MaxLength(128)
  resourceId?: string;

  @ApiPropertyOptional({ enum: ['SUCCESS', 'FAILURE', 'DENIED'] })
  @IsOptional() @IsIn(['SUCCESS', 'FAILURE', 'DENIED'])
  outcome?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional() @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional() @IsDateString({ strict: true })
  to?: string;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ maxLength: 256 })
  @IsOptional() @IsString() @MaxLength(256)
  cursor?: string;
}

export class AuditActorSummaryDto {
  @ApiProperty() username!: string;
  @ApiProperty({ enum: ['INTERNAL', 'SUPPLIER'] }) accountType!: 'INTERNAL' | 'SUPPLIER';
  @ApiProperty() organizationName!: string;
}

export class AuditEventDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String, nullable: true }) actorUserId!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty() actionLabel!: string;
  @ApiProperty({ type: AuditActorSummaryDto, nullable: true }) actorSummary!: AuditActorSummaryDto | null;
  @ApiProperty() resourceType!: string;
  @ApiProperty({ type: String, nullable: true }) resourceId!: string | null;
  @ApiProperty() outcome!: string;
  @ApiProperty({ type: 'object', additionalProperties: { oneOf: [{ type: 'string', nullable: true }, { type: 'number' }, { type: 'boolean' }] } })
  metadata!: Record<string, unknown>;
  @ApiProperty() traceId!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class AuditPageDto {
  @ApiProperty({ type: [AuditEventDto] }) items!: AuditEventDto[];
  @ApiProperty() total!: number;
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
