import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ProblemScopeQueryDto } from '../problem-index/problem-index.dto.js';

export class ProblemAuditQueryDto extends ProblemScopeQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @ApiPropertyOptional({ maxLength: 256 }) @IsOptional() @IsString() @MaxLength(256) cursor?: string;
}
export class ProblemAuditEventDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() action!: string;
  @ApiProperty() outcome!: string;
  @ApiProperty() resourceType!: string;
  @ApiProperty() resourceId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) actorUserId!: string | null;
  @ApiProperty({ type: String, nullable: true }) actorName!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: Number, nullable: true }) resourceVersion!: number | null;
  @ApiProperty({ type: String, nullable: true }) reasonCode!: string | null;
}
export class ProblemAuditPageDto {
  @ApiProperty({ type: [ProblemAuditEventDto] }) items!: ProblemAuditEventDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty() domainRevisionTrailAvailable!: boolean;
}
