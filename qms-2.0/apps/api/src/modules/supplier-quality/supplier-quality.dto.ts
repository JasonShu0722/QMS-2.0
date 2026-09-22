import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { RESPONSE_FORMS, type ResponseForm } from '../problem-index/problem.types.js';
import { MATERIAL_CATEGORIES, SUPPLIER_REPLY_MODES, SUPPLIER_SEVERITIES, type SupplierProblemFacts } from './supplier-quality.types.js';

export class SupplierScopeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000000 }) @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class CreateSupplierProfileDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() supplierOrganizationId!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) businessCode!: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) contactName?: string;
  @ApiPropertyOptional({ maxLength: 254 }) @IsOptional() @IsEmail() @MaxLength(254) contactEmail?: string;
}

export class UpdateSupplierProfileDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) businessCode!: string;
  @ApiPropertyOptional({ maxLength: 100, description: '省略或空白表示清除' }) @IsOptional() @IsString() @MaxLength(100) contactName?: string;
  @ApiPropertyOptional({ maxLength: 254, description: '省略表示清除' }) @IsOptional() @IsEmail() @MaxLength(254) contactEmail?: string;
}

export class SupplierDirectoryQueryDto extends SupplierScopeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() selectedId?: string;
}

export class SupplierReferenceQueryDto extends SupplierDirectoryQueryDto {
  @ApiPropertyOptional({ enum: ['profiles', 'responders'], default: 'profiles' }) @IsIn(['profiles', 'responders']) kind: 'profiles' | 'responders' = 'profiles';
}

export class SupplierProblemQueryDto extends SupplierScopeQueryDto {
  @ApiPropertyOptional({ enum: SUPPLIER_SEVERITIES }) @IsOptional() @IsIn(SUPPLIER_SEVERITIES) severity?: SupplierProblemFacts['severity'];
  @ApiPropertyOptional({ enum: RESPONSE_FORMS }) @IsOptional() @IsIn(RESPONSE_FORMS) responseForm?: ResponseForm;
  @ApiPropertyOptional({ enum: ['DRAFT', 'ISSUED'] }) @IsOptional() @IsIn(['DRAFT', 'ISSUED']) stage?: 'DRAFT' | 'ISSUED';
}

export class SupplierProfileDto {
  @ApiProperty() id!: string;
  @ApiProperty() version!: number;
  @ApiProperty() supplierOrganizationId!: string;
  @ApiProperty() businessCode!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional() contactName?: string;
  @ApiPropertyOptional() contactEmail?: string;
}

export class SupplierProfilePageDto {
  @ApiProperty({ type: [SupplierProfileDto] }) items!: SupplierProfileDto[];
  @ApiProperty() total!: number;
  @ApiProperty() canManage!: boolean;
}

export class SupplierReferenceOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
}

export class SupplierReferenceOptionsDto {
  @ApiProperty({ type: [SupplierReferenceOptionDto] }) items!: SupplierReferenceOptionDto[];
  @ApiProperty() total!: number;
}

export class SupplierProblemDraftDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() profileId!: string;
  @ApiProperty({ maxLength: 500 }) @IsString() @MaxLength(500) title!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) materialCode!: string;
  @ApiPropertyOptional({ enum: MATERIAL_CATEGORIES }) @IsOptional() @IsIn(MATERIAL_CATEGORIES) materialCategory?: SupplierProblemFacts['materialCategory'];
  @ApiProperty({ maxLength: 10000 }) @IsString() @MaxLength(10000) defectDescription!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) @IsInt() @Min(1) @Max(2147483647) defectQuantity!: number;
  @ApiProperty({ enum: SUPPLIER_SEVERITIES }) @IsIn(SUPPLIER_SEVERITIES) severity!: SupplierProblemFacts['severity'];
  @ApiProperty({ enum: RESPONSE_FORMS }) @IsIn(RESPONSE_FORMS) responseForm!: ResponseForm;
  @ApiProperty({ enum: SUPPLIER_REPLY_MODES }) @IsIn(SUPPLIER_REPLY_MODES) replyMode!: SupplierProblemFacts['replyMode'];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() internalResponderId?: string;
}

export class UpdateSupplierProblemDraftDto extends SupplierProblemDraftDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class IssueSupplierProblemDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class SupplierResponseContentDto {
  @ApiPropertyOptional({ maxLength: 10000 }) @IsOptional() @IsString() @MaxLength(10000) problemDescription?: string;
  @ApiPropertyOptional({ maxLength: 10000 }) @IsOptional() @IsString() @MaxLength(10000) containmentAction?: string;
  @ApiPropertyOptional({ maxLength: 10000 }) @IsOptional() @IsString() @MaxLength(10000) interimAction?: string;
  @ApiPropertyOptional({ maxLength: 10000 }) @IsOptional() @IsString() @MaxLength(10000) rootCause?: string;
  @ApiPropertyOptional({ maxLength: 10000 }) @IsOptional() @IsString() @MaxLength(10000) correctiveAction?: string;
  @ApiPropertyOptional({ maxLength: 10000 }) @IsOptional() @IsString() @MaxLength(10000) preventiveAction?: string;
  @ApiPropertyOptional({ maxLength: 10000 }) @IsOptional() @IsString() @MaxLength(10000) verificationResult?: string;
  @ApiPropertyOptional({ description: '包含时区的完成时间' }) @IsOptional() @IsString() @MaxLength(50) completionTime?: string;
}

export class SaveSupplierResponseDraftDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ type: SupplierResponseContentDto }) @ValidateNested() @Type(() => SupplierResponseContentDto) content!: SupplierResponseContentDto;
}

export class SupplierProblemDto extends SupplierProblemDraftDto {
  @ApiProperty() id!: string;
  @ApiProperty() supplierOrganizationId!: string;
  @ApiProperty() supplierName!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['DRAFT', 'ISSUED'] }) stage!: 'DRAFT' | 'ISSUED';
  @ApiPropertyOptional() reportNumber?: string;
  @ApiPropertyOptional({ enum: ['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'ARCHIVED'] }) problemStatus?: 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED' | 'ARCHIVED';
  @ApiPropertyOptional({ format: 'date-time' }) dueAt?: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty() canEditFacts!: boolean;
  @ApiProperty() canEditResponse!: boolean;
  @ApiProperty({ type: SupplierResponseContentDto }) responseDraft!: SupplierResponseContentDto;
}

export class SupplierProblemPageDto {
  @ApiProperty({ type: [SupplierProblemDto] }) items!: SupplierProblemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() canCreateDraft!: boolean;
}
