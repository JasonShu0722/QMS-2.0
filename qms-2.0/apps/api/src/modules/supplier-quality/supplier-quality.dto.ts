import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
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
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() supplierOrganizationId?: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) businessCode!: string;
  @ApiPropertyOptional({ maxLength: 200, description: '未绑定供应商企业时必填；供应商自有名称' }) @IsOptional() @IsString() @MaxLength(200) displayName?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) contactName?: string;
  @ApiPropertyOptional({ maxLength: 254 }) @IsOptional() @IsEmail() @MaxLength(254) contactEmail?: string;
}

export class UpdateSupplierProfileDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) businessCode!: string;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) displayName?: string;
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

export class SupplierProblemDetailQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000000 }) @Type(() => Number) @IsInt() @Min(1) @Max(1000000) revisionPage = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 20 }) @Type(() => Number) @IsInt() @Min(1) @Max(20) revisionPageSize = 20;
}

export class SupplierProfileDto {
  @ApiProperty() id!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, nullable: true }) supplierOrganizationId!: string | null;
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

export class SubmitSupplierResponseDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedContentVersion!: number;
  @ApiProperty({ type: SupplierResponseContentDto }) @ValidateNested() @Type(() => SupplierResponseContentDto) content!: SupplierResponseContentDto;
  @ApiPropertyOptional({ type: [String], maxItems: 10, format: 'uuid' }) @IsOptional() @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsUUID('4', { each: true }) evidenceFileIds?: string[];
  @ApiPropertyOptional({ default: 'RESPONSE', maxLength: 100 }) @IsOptional() @IsString() @Length(1, 100) evidencePurpose?: string;
}

export class SupplierWorkflowActionDto {
  @ApiProperty({ enum: ['VERIFY', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE'] }) @IsIn(['VERIFY', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE']) action!: 'VERIFY' | 'REJECT' | 'RETURN' | 'REOPEN' | 'CLOSE';
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedContentVersion!: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() accepted?: boolean;
}

export class SupplierResponseEvidenceDto {
  @ApiProperty({ format: 'uuid' }) fileId!: string;
  @ApiProperty() purpose!: string;
  @ApiProperty() originalName!: string;
  @ApiProperty({ enum: ['QUARANTINED', 'AVAILABLE', 'DELETED'] }) status!: string;
  @ApiProperty({ enum: ['WAITING_UPLOAD', 'PENDING', 'CLEAN', 'REJECTED', 'ERROR', 'EXPIRED'] }) scanStatus!: string;
  @ApiProperty() downloadable!: boolean;
}

export class SupplierResponseRevisionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ type: SupplierResponseContentDto }) content!: SupplierResponseContentDto;
  @ApiProperty({ format: 'date-time' }) submittedAt!: string;
  @ApiProperty({ type: [SupplierResponseEvidenceDto] }) evidence!: SupplierResponseEvidenceDto[];
}

export class SupplierResponseRevisionPageDto {
  @ApiProperty({ type: [SupplierResponseRevisionDto], description: '修订号降序；通过 revisionPage 翻页' }) items!: SupplierResponseRevisionDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 20 }) pageSize!: number;
}

export class SupplierCurrentVerificationDto {
  @ApiProperty({ enum: ['NOT_VERIFIED', 'ACCEPTED', 'INVALIDATED'] }) status!: 'NOT_VERIFIED' | 'ACCEPTED' | 'INVALIDATED';
  @ApiPropertyOptional({ format: 'uuid' }) revisionId?: string;
  @ApiPropertyOptional({ format: 'date-time' }) verifiedAt?: string;
  @ApiPropertyOptional({ format: 'uuid', description: '仅内部详情返回' }) verifierId?: string;
}

export class SupplierWorkflowNodeDto {
  @ApiProperty({ enum: ['ACTION', 'APPROVAL', 'VERIFICATION', 'CC', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE'] }) type!: string;
  @ApiPropertyOptional({ format: 'uuid', description: '仅内部详情返回' }) id?: string;
  @ApiPropertyOptional({ description: '仅内部详情返回' }) name?: string;
}

export class SupplierProblemDto extends SupplierProblemDraftDto {
  @ApiPropertyOptional({ description: '使用完整8D工作区；旧详情不返回其正文或内部补充资料' }) controlledEightD?: boolean;
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, nullable: true }) supplierOrganizationId!: string | null;
  @ApiProperty() supplierName!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['DRAFT', 'ISSUED'] }) stage!: 'DRAFT' | 'ISSUED';
  @ApiPropertyOptional({ format: 'uuid', description: '仅内部详情返回；平台工作台使用的问题索引 ID' }) problemIndexId?: string;
  @ApiPropertyOptional() reportNumber?: string;
  @ApiPropertyOptional({ enum: ['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'ARCHIVED'] }) problemStatus?: 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED' | 'ARCHIVED';
  @ApiPropertyOptional({ format: 'date-time' }) dueAt?: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty() canEditFacts!: boolean;
  @ApiProperty() canEditResponse!: boolean;
  @ApiProperty({ type: SupplierResponseContentDto }) responseDraft!: SupplierResponseContentDto;
  @ApiPropertyOptional({ type: SupplierResponseRevisionDto, description: '详情中的最新已提交修订，草稿阶段省略' }) latestResponseRevision?: SupplierResponseRevisionDto;
  @ApiPropertyOptional({ type: SupplierResponseRevisionPageDto, description: '详情中的全部修订分页，按修订号降序' }) responseHistory?: SupplierResponseRevisionPageDto;
  @ApiPropertyOptional({ type: SupplierCurrentVerificationDto, description: '详情中针对最新修订的当前验证状态' }) currentVerification?: SupplierCurrentVerificationDto;
  @ApiPropertyOptional({ type: SupplierWorkflowNodeDto, description: '详情中的当前流程节点，未发单时省略' }) currentWorkflowNode?: SupplierWorkflowNodeDto;
  @ApiPropertyOptional({ enum: ['SUBMIT', 'VERIFY', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE'], isArray: true, description: '详情中按当前会话、节点和领域规则派生的候选动作；提交时仍由服务端重新授权' }) availableActions?: ('SUBMIT' | 'VERIFY' | 'REJECT' | 'RETURN' | 'REOPEN' | 'CLOSE')[];
  @ApiPropertyOptional({ type: String, nullable: true, description: '详情中无可执行动作时的原因代码；有动作时为 null' }) actionUnavailableReason?: string | null;
}

export class SupplierProblemPageDto {
  @ApiProperty({ type: [SupplierProblemDto] }) items!: SupplierProblemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() canCreateDraft!: boolean;
}
