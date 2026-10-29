import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';

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
