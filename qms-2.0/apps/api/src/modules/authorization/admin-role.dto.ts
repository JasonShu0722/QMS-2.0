import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';

export class AdminPermissionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;
}

export class AdminRoleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  organizationId!: string | null;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [AdminPermissionDto] })
  permissions!: AdminPermissionDto[];
}

export class PermissionCatalogOperationDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['guarded', 'reserved'] })
  enforcement!: 'guarded' | 'reserved';

  @ApiProperty()
  grantable!: boolean;
}

export class PermissionCatalogModuleDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['active', 'planned'] })
  status!: 'active' | 'planned';

  @ApiProperty({ type: [PermissionCatalogOperationDto] })
  operations!: PermissionCatalogOperationDto[];
}

export class PermissionCatalogGroupDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['active', 'planned'] })
  status!: 'active' | 'planned';

  @ApiProperty({ type: [PermissionCatalogModuleDto] })
  modules!: PermissionCatalogModuleDto[];
}

export class AdminRoleScopeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class CopyAdminRoleDto {
  @ApiProperty({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z][A-Za-z0-9_-]*$' })
  @IsString()
  @Length(1, 100)
  @Matches(/^[A-Za-z][A-Za-z0-9_-]*$/)
  code!: string;

  @ApiProperty({ minLength: 1, maxLength: 150 })
  @IsString()
  @Length(1, 150)
  @Matches(/\S/)
  name!: string;
}

export class CreateAdminRoleDto extends CopyAdminRoleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ type: [String], maxItems: 200 })
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 150, { each: true })
  @Matches(/\S/, { each: true })
  permissionCodes!: string[];
}

export class UpdateAdminRoleDto {
  @ApiPropertyOptional({ type: [String], maxItems: 200, description: 'Required when permissionCodes is supplied; previously read permission set.' })
  @ValidateIf((object: UpdateAdminRoleDto, value) => object.permissionCodes !== undefined || value !== undefined)
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 150, { each: true })
  @Matches(/\S/, { each: true })
  expectedPermissionCodes?: string[];

  @ApiPropertyOptional({ minLength: 1, maxLength: 150 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 150)
  @Matches(/\S/)
  name?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 200 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 150, { each: true })
  @Matches(/\S/, { each: true })
  permissionCodes?: string[];
}

export class AssignAdminRolesDto {
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  roleIds!: string[];
}

export class AdminUserRolesDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty({ type: [AdminRoleDto] })
  roles!: AdminRoleDto[];

  @ApiProperty({ type: [String] })
  permissions!: string[];
}
