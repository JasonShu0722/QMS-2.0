import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { OrganizationSummaryDto, ProfileFieldsDto } from './account.dto.js';
import { UserPositionSummaryDto } from '../../organization/position-onboarding.dto.js';

const ACCOUNT_TYPES = ['INTERNAL', 'SUPPLIER'] as const;
const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;

export class AdminMfaPolicyInputDto {
  @ApiProperty()
  @IsBoolean()
  required!: boolean;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedSecurityVersion!: number;
}

export class AdminMfaPolicyDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  required!: boolean;

  @ApiProperty()
  bound!: boolean;

  @ApiProperty({ type: Boolean, nullable: true })
  override!: boolean | null;

  @ApiProperty()
  roleRequired!: boolean;

  @ApiProperty()
  securityVersion!: number;

  @ApiProperty()
  selfSessionRevoked!: boolean;
}

export class AdminUserListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];

  @ApiPropertyOptional({ enum: ACCOUNT_TYPES })
  @IsOptional()
  @IsIn(ACCOUNT_TYPES)
  accountType?: (typeof ACCOUNT_TYPES)[number];

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateAdminUserDto extends ProfileFieldsDto {
  @ApiPropertyOptional({ type: [String], minItems: 1, maxItems: 100, description: '内部账号必填；供应商专用开通不要求内部岗位。' })
  @ValidateIf((object: CreateAdminUserDto, value) => object.accountType === 'INTERNAL' || value !== undefined)
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all', { each: true })
  positionIds?: string[];

  @ApiPropertyOptional({ minLength: 1, maxLength: 256, description: '内部账号必填，使用岗位授权预览返回的完整基线。' })
  @ValidateIf((object: CreateAdminUserDto, value) => object.accountType === 'INTERNAL' || value !== undefined)
  @IsString() @Length(1, 256)
  authorizationBaseline?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @Matches(/^[a-zA-Z0-9._-]+$/)
  username!: string;

  @ApiProperty({ enum: ACCOUNT_TYPES })
  @IsIn(ACCOUNT_TYPES)
  accountType!: (typeof ACCOUNT_TYPES)[number];

  @ApiProperty()
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ minLength: 12, maxLength: 256 })
  @IsString()
  @Length(12, 256)
  initialPassword!: string;
}

export class UpdateAdminUserDto extends ProfileFieldsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 2147483647, description: '修改姓名、电话或邮箱时必填' })
  @ValidateIf((object: UpdateAdminUserDto, value) => value !== undefined || object.fullName !== undefined || object.phone !== undefined || object.email !== undefined)
  @IsInt() @Min(1) @Max(2147483647)
  expectedProfileVersion?: number;

  @ApiPropertyOptional({ enum: ACCOUNT_TYPES })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(ACCOUNT_TYPES)
  accountType?: (typeof ACCOUNT_TYPES)[number];

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];
}

export class ResetAdminUserPasswordDto {
  @ApiProperty({ minLength: 32, maxLength: 256 })
  @IsString()
  @Length(32, 256)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  temporaryCode!: string;
}

export class PasswordResetIssuedDto {
  @ApiProperty({ format: 'uuid' })
  resetId!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class CompletePasswordResetDto extends ResetAdminUserPasswordDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  resetId!: string;

  @ApiProperty({ minLength: 12, maxLength: 256 })
  @IsString()
  @Length(12, 256)
  newPassword!: string;
}

export class AdminUserDto {
  @ApiProperty({ minimum: 1, description: '删除操作的实时身份版本，不替代资料版本。' })
  securityVersion!: number;

  @ApiPropertyOptional({ type: [UserPositionSummaryDto], maxItems: 3, description: '最多展示三个有效任职，完整数量见 totalPositions。' })
  positions?: UserPositionSummaryDto[];

  @ApiPropertyOptional({ minimum: 0 })
  totalPositions?: number;

  @ApiProperty({ type: String, nullable: true, maxLength: 100 })
  fullName!: string | null;

  @ApiProperty({ type: String, nullable: true, maxLength: 40 })
  phone!: string | null;

  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  profileVersion!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  emailVerifiedAt!: Date | null;

  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ enum: ACCOUNT_TYPES })
  accountType!: (typeof ACCOUNT_TYPES)[number];

  @ApiProperty({ enum: USER_STATUSES })
  status!: (typeof USER_STATUSES)[number];

  @ApiProperty()
  mfaEnabled!: boolean;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty({ type: OrganizationSummaryDto })
  organization!: OrganizationSummaryDto;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class AdminOrganizationDto extends OrganizationSummaryDto {
  @ApiProperty({ enum: ACCOUNT_TYPES })
  type!: (typeof ACCOUNT_TYPES)[number];

  @ApiProperty({ type: [String] })
  permissions!: string[];
}

export class AdminOrganizationContextQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class AdminAuthorizationSourceDto {
  @ApiProperty({ format: 'uuid' })
  roleId!: string;

  @ApiProperty()
  roleCode!: string;

  @ApiProperty()
  roleName!: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  sourceOrganizationIds!: string[];

  @ApiProperty({ enum: ['DIRECT', 'POSITION'], isArray: true })
  sourceKinds!: ('DIRECT' | 'POSITION')[];

  @ApiProperty()
  platformAdministrator!: boolean;
}

export class AdminOrganizationContextDto {
  @ApiProperty()
  hasPlatformAdministrator!: boolean;

  @ApiProperty({ format: 'uuid' })
  homeOrganizationId!: string;

  @ApiProperty({ format: 'uuid' })
  targetOrganizationId!: string;

  @ApiProperty({ enum: ['PLATFORM', 'ORGANIZATION', 'NONE'] })
  accessKind!: 'PLATFORM' | 'ORGANIZATION' | 'NONE';

  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  targetOrganizationStatus!: 'ACTIVE' | 'DISABLED';

  @ApiProperty()
  targetConfigurationRequired!: boolean;

  @ApiProperty({ type: [String], description: '当前目标范围实际可用的管理权限，不含平台身份 marker 或业务办理权限。' })
  permissions!: string[];

  @ApiProperty({ type: [AdminAuthorizationSourceDto] })
  authorizationSources!: AdminAuthorizationSourceDto[];
}
