import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, ValidateNested } from 'class-validator';
import { CreatePositionDto } from './organization.dto.js';

export class LegacyAuthorizationPreviewInputDto {
  @ApiProperty({ enum: ['MIGRATE', 'REMOVE'] }) @IsIn(['MIGRATE', 'REMOVE']) operation!: 'MIGRATE' | 'REMOVE';
  @ApiProperty({ type: [String], maxItems: 100 }) @IsArray() @ArrayUnique() @ArrayMaxSize(100) @IsUUID('all', { each: true }) directUserIds!: string[];
  @ApiProperty({ type: [String], maxItems: 100 }) @IsArray() @ArrayUnique() @ArrayMaxSize(100) @IsUUID('all', { each: true }) sourcePositionIds!: string[];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() targetPositionId?: string;
  @ApiPropertyOptional({ type: CreatePositionDto }) @IsOptional() @ValidateNested() @Type(() => CreatePositionDto) newPosition?: CreatePositionDto;
  @ApiPropertyOptional({ description: '保留稳定 roleCode 的显式兼容岗位映射；权限与资格来源在预览中分别展示。' }) @IsOptional() @IsBoolean() preserveRoleCode?: boolean;
}

export class LegacyAuthorizationCommitDto extends LegacyAuthorizationPreviewInputDto {
  @ApiProperty({ minLength: 1, maxLength: 256 }) @IsString() @Length(1, 256) authorizationBaseline!: string;
  @ApiProperty({ type: [String], description: '必须精确确认预览列出的全部扩散用户，包含未来任职。' }) @IsArray() @ArrayUnique() @ArrayMaxSize(1000) @IsUUID('all', { each: true }) confirmedImpactUserIds!: string[];
}

export class LegacyAuthorizationRoleDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, nullable: true }) organizationId!: string | null;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() mfaRequired!: boolean;
  @ApiProperty({ type: [String] }) permissionCodes!: string[];
  @ApiProperty() platformMarker!: boolean;
}

export class LegacyAuthorizationDirectSourceDto {
  @ApiProperty() userId!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() roleId!: string;
  @ApiProperty() selected!: boolean;
  @ApiProperty() initialization!: boolean;
}

export class LegacyAuthorizationAssignmentDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() positionId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) startedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endedAt!: string | null;
  @ApiProperty({ enum: ['CURRENT', 'FUTURE', 'ENDED', 'UNAVAILABLE'] }) temporalState!: string;
}

export class LegacyAuthorizationMappingDto {
  @ApiProperty() positionId!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() roleId!: string;
  @ApiProperty() isCanonical!: boolean;
  @ApiProperty() selected!: boolean;
  @ApiProperty({ type: [LegacyAuthorizationAssignmentDto] }) assignments!: LegacyAuthorizationAssignmentDto[];
}

export class LegacyAuthorizationWorkflowReferenceDto {
  @ApiProperty() organizationId!: string;
  @ApiProperty() versionId!: string;
  @ApiProperty() nodeId!: string;
  @ApiProperty() status!: string;
  @ApiProperty() roleCode!: string;
}

export class LegacyAuthorizationUserImpactDto {
  @ApiProperty() userId!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() securityVersion!: number;
  @ApiProperty() status!: string;
  @ApiProperty() accountType!: string;
  @ApiProperty() mfaEnabled!: boolean;
  @ApiProperty({ type: [String] }) beforePermissionCodes!: string[];
  @ApiProperty({ type: [String] }) afterPermissionCodes!: string[];
  @ApiProperty({ type: [String] }) beforeRoleCodes!: string[];
  @ApiProperty({ type: [String] }) afterRoleCodes!: string[];
  @ApiProperty() beforeMfaRequired!: boolean;
  @ApiProperty() afterMfaRequired!: boolean;
  @ApiProperty() beforePlatformAdministrator!: boolean;
  @ApiProperty() afterPlatformAdministrator!: boolean;
  @ApiProperty({ type: [LegacyAuthorizationAssignmentDto] }) appointments!: LegacyAuthorizationAssignmentDto[];
}

export class LegacyAuthorizationTargetDto {
  @ApiProperty({ type: String, nullable: true }) positionId!: string | null;
  @ApiProperty() canonicalRoleId!: string;
  @ApiProperty() roleCode!: string;
  @ApiProperty({ type: String, nullable: true }) departmentId!: string | null;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: LegacyAuthorizationRoleDto, nullable: true }) originalCanonical!: LegacyAuthorizationRoleDto | null;
  @ApiProperty({ enum: ['ADOPT', 'INDEPENDENT_CANONICAL', 'MERGE_WITH_QUALIFICATION', 'MERGE', 'REMOVE'] }) strategy!: string;
  @ApiProperty({ type: [String] }) permissionCodes!: string[];
  @ApiProperty() mfaRequired!: boolean;
}

export class LegacyAuthorizationUserLabelDto {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ type: String, nullable: true }) fullName!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() unavailable!: boolean;
}

export class LegacyAuthorizationDepartmentLabelDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}

export class LegacyAuthorizationPositionLabelDto {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty({ type: String, nullable: true }) departmentId!: string | null;
  @ApiProperty({ type: LegacyAuthorizationDepartmentLabelDto, nullable: true }) department!: LegacyAuthorizationDepartmentLabelDto | null;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() status!: string;
  @ApiProperty() version!: number;
  @ApiProperty() roleVersion!: number;
  @ApiProperty() unavailable!: boolean;
}

export class LegacyAuthorizationOrganizationLabelDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}

export class LegacyAuthorizationLabelsDto {
  @ApiProperty({ type: [LegacyAuthorizationUserLabelDto] }) users!: LegacyAuthorizationUserLabelDto[];
  @ApiProperty({ type: [LegacyAuthorizationPositionLabelDto] }) positions!: LegacyAuthorizationPositionLabelDto[];
  @ApiProperty({ type: [LegacyAuthorizationOrganizationLabelDto] }) organizations!: LegacyAuthorizationOrganizationLabelDto[];
}

export class LegacyAuthorizationPreviewDto {
  @ApiProperty() authorizationBaseline!: string;
  @ApiProperty({ type: LegacyAuthorizationRoleDto }) role!: LegacyAuthorizationRoleDto;
  @ApiProperty({ type: [LegacyAuthorizationDirectSourceDto] }) directSources!: LegacyAuthorizationDirectSourceDto[];
  @ApiProperty({ type: [LegacyAuthorizationMappingDto] }) mappedSources!: LegacyAuthorizationMappingDto[];
  @ApiProperty({ type: LegacyAuthorizationTargetDto, nullable: true }) target!: LegacyAuthorizationTargetDto | null;
  @ApiProperty({ type: [LegacyAuthorizationWorkflowReferenceDto] }) workflowReferences!: LegacyAuthorizationWorkflowReferenceDto[];
  @ApiProperty({ type: [LegacyAuthorizationUserImpactDto] }) affectedUsers!: LegacyAuthorizationUserImpactDto[];
  @ApiProperty({ type: [String] }) impactUserIds!: string[];
  @ApiProperty({ description: '仍未处置的来源数；资格兼容映射不冒称已清理。' }) retainedSourceCount!: number;
  @ApiProperty({ type: LegacyAuthorizationLabelsDto, description: '仅真实授权scope内的可读标签；随精确预览基线及历史事实固定。' }) labels!: LegacyAuthorizationLabelsDto;
}

export class LegacyAuthorizationResultDto {
  @ApiProperty() roleId!: string;
  @ApiProperty({ type: String, nullable: true }) targetPositionId!: string | null;
  @ApiProperty() archived!: boolean;
  @ApiProperty() deleted!: boolean;
  @ApiProperty() selfSessionRevoked!: boolean;
}
