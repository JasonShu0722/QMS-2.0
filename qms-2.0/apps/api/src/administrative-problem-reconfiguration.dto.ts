import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, IsUUID, Max, MaxLength, ValidateIf } from 'class-validator';
import { InternalEightDAdministrativeQueryDto, InternalEightDAdministrativeReconfigureDto } from './common/eight-d/internal-eight-d-administrative.dto.js';

export enum AdministrativeProblemDomain { PROCESS = 'PROCESS', CUSTOMER = 'CUSTOMER', NEW_PRODUCT = 'NEW_PRODUCT', SUPPLIER = 'SUPPLIER' }
export enum AdministrativeProblemDuty { PROFESSIONAL = 'PROFESSIONAL', OWNER = 'OWNER', RESPONDER = 'RESPONDER' }
export class AdministrativeProblemReconfigureDto extends InternalEightDAdministrativeReconfigureDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined) @IsUUID() sqeAssignmentId?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined) @IsUUID() internalResponderAssignmentId?: string;
}
export class AdministrativeProblemAssignmentQueryDto extends InternalEightDAdministrativeQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 10000, default: 0 }) @Max(10000) offset = 0;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() organizationId!: string;
  @ApiProperty({ enum: AdministrativeProblemDuty }) @IsEnum(AdministrativeProblemDuty) duty!: AdministrativeProblemDuty;
  @ApiPropertyOptional({ type: String, maxLength: 100 })
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(100) search?: string;
}
export class AdministrativeProblemAssignmentDto {
  @ApiProperty({ format: 'uuid' }) assignmentId!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ type: String, nullable: true }) fullName!: string | null;
  @ApiProperty() positionName!: string;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty() departmentName!: string;
}
export class AdministrativeProblemAssignmentPageDto {
  @ApiProperty({ type: [AdministrativeProblemAssignmentDto] }) items!: AdministrativeProblemAssignmentDto[];
  @ApiProperty() total!: number;
}
