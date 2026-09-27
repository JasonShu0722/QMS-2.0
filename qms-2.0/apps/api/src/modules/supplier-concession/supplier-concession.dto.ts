import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ConcessionQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() inspectionId?: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RELEASED', 'WITHDRAWN'] }) @IsOptional() @IsIn(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RELEASED', 'WITHDRAWN']) status?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class CreateConcessionDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() inspectionId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) quantity!: number;
  @ApiProperty({ maxLength: 2000 }) @IsString() @MaxLength(2000) reason!: string;
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() expiresAt!: Date;
}

export class ConcessionVersionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class DecideConcessionDto extends ConcessionVersionDto {
  @ApiProperty({ maxLength: 2000 }) @IsString() @MaxLength(2000) note!: string;
}

export class ConcessionRecordDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) inspectionId!: string;
  @ApiProperty() inspectionVersion!: number;
  @ApiProperty({ format: 'uuid' }) profileId!: string;
  @ApiProperty() supplierName!: string;
  @ApiProperty() materialCode!: string;
  @ApiProperty() incomingBatch!: string;
  @ApiProperty() receivedQuantity!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RELEASED', 'WITHDRAWN'] }) status!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) requestedById!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) approvedById!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) approvedAt!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) releasedAt!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) decisionNote!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) releaseNote!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiPropertyOptional() canSubmit?: boolean;
  @ApiPropertyOptional() canWithdraw?: boolean;
  @ApiPropertyOptional() canApprove?: boolean;
  @ApiPropertyOptional() canRelease?: boolean;
}

export class ConcessionEventDto {
  @ApiProperty({ enum: ['CREATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RELEASED', 'WITHDRAWN'] }) eventType!: string;
  @ApiProperty() requestVersion!: number;
  @ApiProperty({ format: 'uuid' }) actorUserId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ConcessionDetailDto extends ConcessionRecordDto {
  @ApiProperty({ type: [ConcessionEventDto] }) events!: ConcessionEventDto[];
}

export class ConcessionPageDto {
  @ApiProperty({ type: [ConcessionRecordDto] }) items!: ConcessionRecordDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() canCreate!: boolean;
}
