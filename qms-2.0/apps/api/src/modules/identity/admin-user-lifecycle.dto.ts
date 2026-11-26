import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';

export const ADMIN_USER_DELETE_MODES = ['STANDARD', 'FORCE'] as const;
export type AdminUserDeleteMode = typeof ADMIN_USER_DELETE_MODES[number];

export class AdminUserLifecycleQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  organizationId?: string;
}

export class DeleteAdminUserDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedSecurityVersion!: number;
}

export class DeleteInternalAdminUserDto extends DeleteAdminUserDto {
  @ApiPropertyOptional({ enum: [...ADMIN_USER_DELETE_MODES], description: 'STANDARD 在存在当前引用时拒绝删除；省略时沿用 FORCE。' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(ADMIN_USER_DELETE_MODES)
  mode?: AdminUserDeleteMode;
}

export class AdminUserLifecycleEffectDto {
  @ApiProperty({ enum: ['workflow', 'platform-configuration', 'identity'] })
  module!: string;

  @ApiProperty({ minimum: 0 })
  changed!: number;

  @ApiProperty({ minimum: 0 })
  pendingConfiguration!: number;
}

export class AdminUserForceDeleteResultDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ enum: [true] })
  deleted!: true;

  @ApiProperty({ type: AdminUserLifecycleEffectDto, isArray: true })
  effects!: AdminUserLifecycleEffectDto[];
}
