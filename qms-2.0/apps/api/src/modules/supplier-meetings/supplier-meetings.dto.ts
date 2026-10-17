import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const SUPPLIER_MEETING_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const SUPPLIER_MEETING_ACTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

export class SupplierMeetingQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() profileId?: string;
  @ApiPropertyOptional({ enum: SUPPLIER_MEETING_STATUSES }) @IsOptional() @IsIn(SUPPLIER_MEETING_STATUSES) status?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class CreateSupplierMeetingDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() profileId!: string;
  @ApiProperty({ maxLength: 300 }) @IsString() @MaxLength(300) title!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() scheduledStart!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() scheduledEnd!: string;
  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @IsString() @MaxLength(300) location?: string;
}

export class SupplierMeetingTransitionDto { @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number; }

export class CreateSupplierMeetingTopicDto {
  @ApiProperty({ maxLength: 300 }) @IsString() @MaxLength(300) title!: string;
  @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @IsInt() @Min(1) sequence?: number;
}

export class ConcludeSupplierMeetingTopicDto extends SupplierMeetingTransitionDto {
  @ApiProperty({ maxLength: 5000 }) @IsString() @MaxLength(5000) conclusion!: string;
}

export class CreateSupplierMeetingActionDto {
  @ApiProperty({ maxLength: 500 }) @IsString() @MaxLength(500) title!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() assigneeUserId!: string;
  @ApiProperty({ format: 'date' }) @IsDateString() dueDate!: string;
}

export class CompleteSupplierMeetingActionDto extends SupplierMeetingTransitionDto {}

export class SupplierMeetingDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) ownerOrganizationId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) supplierOrganizationId!: string | null;
  @ApiProperty({ format: 'uuid' }) profileId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date-time' }) scheduledStart!: string;
  @ApiProperty({ format: 'date-time' }) scheduledEnd!: string;
  @ApiPropertyOptional({ nullable: true }) location!: string | null;
  @ApiProperty({ enum: SUPPLIER_MEETING_STATUSES }) status!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class SupplierMeetingTopicDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) meetingId!: string;
  @ApiProperty() sequence!: number;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true }) conclusion!: string | null;
  @ApiProperty({ enum: ['OPEN', 'CONCLUDED'] }) status!: string;
  @ApiProperty() version!: number;
}

export class SupplierMeetingActionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) meetingId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'uuid' }) assigneeUserId!: string;
  @ApiProperty({ format: 'date' }) dueDate!: string;
  @ApiProperty({ enum: SUPPLIER_MEETING_ACTION_STATUSES }) status!: string;
  @ApiProperty() version!: number;
}

export class SupplierMeetingPageDto { @ApiProperty({ type: [SupplierMeetingDto] }) items!: SupplierMeetingDto[]; @ApiProperty() total!: number; @ApiProperty() page!: number; @ApiProperty() pageSize!: number; }
