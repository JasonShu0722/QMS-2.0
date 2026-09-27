import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CoordinateScopeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}

export class CreateCoordinateInspectionDto extends CoordinateScopeDto {
  @ApiProperty({ maxLength: 120 }) @IsString() @MaxLength(120) partNumber!: string;
  @ApiProperty({ maxLength: 240 }) @IsString() @MaxLength(240) partName!: string;
  @ApiPropertyOptional({ maxLength: 80 }) @IsOptional() @IsString() @MaxLength(80) drawingRevision?: string;
  @ApiPropertyOptional({ maxLength: 160 }) @IsOptional() @IsString() @MaxLength(160) batchNumber?: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483647) sampleQuantity!: number;
  @ApiProperty({ enum: ['INCOMING', 'PROCESS', 'CUSTOMER', 'NEW_PRODUCT', 'OTHER'] }) @IsIn(['INCOMING', 'PROCESS', 'CUSTOMER', 'NEW_PRODUCT', 'OTHER']) purpose!: string;
  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL' }) @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority: string = 'NORMAL';
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() requestedDueAt?: Date;
}

export class UpdateCoordinateInspectionDto extends CoordinateScopeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiPropertyOptional({ maxLength: 120 }) @IsOptional() @IsString() @MaxLength(120) partNumber?: string;
  @ApiPropertyOptional({ maxLength: 240 }) @IsOptional() @IsString() @MaxLength(240) partName?: string;
  @ApiPropertyOptional({ maxLength: 80 }) @IsOptional() @IsString() @MaxLength(80) drawingRevision?: string;
  @ApiPropertyOptional({ maxLength: 160 }) @IsOptional() @IsString() @MaxLength(160) batchNumber?: string;
  @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @IsInt() @Min(1) @Max(2147483647) sampleQuantity?: number;
  @ApiPropertyOptional({ enum: ['INCOMING', 'PROCESS', 'CUSTOMER', 'NEW_PRODUCT', 'OTHER'] }) @IsOptional() @IsIn(['INCOMING', 'PROCESS', 'CUSTOMER', 'NEW_PRODUCT', 'OTHER']) purpose?: string;
  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] }) @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Type(() => Date) @IsDate() requestedDueAt?: Date;
}

export class SubmitCoordinateInspectionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class ApproveCoordinateInspectionDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class ScheduleCoordinateInspectionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() scheduledAt!: Date;
  @ApiProperty({ format: 'uuid' }) @IsUUID() assignedToId!: string;
}

export class ProgressCoordinateInspectionDto {
  @ApiProperty({ enum: ['IN_PROGRESS', 'COMPLETED'] }) @IsIn(['IN_PROGRESS', 'COMPLETED']) status!: 'IN_PROGRESS' | 'COMPLETED';
  @ApiProperty({ minimum: 0, maximum: 100 }) @IsInt() @Min(0) @Max(100) progressPercent!: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class CoordinateInspectionQueryDto extends CoordinateScopeDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] }) @IsOptional() @IsIn(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED']) status?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class CoordinateInspectionRequestDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() requestNumber!: string;
  @ApiProperty() partNumber!: string;
  @ApiProperty() partName!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) drawingRevision!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) batchNumber!: string | null;
  @ApiProperty() sampleQuantity!: number;
  @ApiProperty() purpose!: string;
  @ApiProperty() priority!: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) requestedDueAt!: string | null;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) approvalNote!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) approvedById!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) approvedAt!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) scheduledAt!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) scheduledById!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) assignedToId!: string | null;
  @ApiProperty() progressPercent!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) progressNote!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) createdById!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CoordinateInspectionPageDto {
  @ApiProperty({ type: [CoordinateInspectionRequestDto] }) items!: CoordinateInspectionRequestDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
