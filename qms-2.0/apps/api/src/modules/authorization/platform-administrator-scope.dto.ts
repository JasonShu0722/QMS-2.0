import { ApiProperty } from '@nestjs/swagger';
import type { PlatformAdministratorScope } from '../../common/security/effective-role-grants.js';

export class PlatformAdministratorScopeDto implements PlatformAdministratorScope {
  @ApiProperty({ enum: ['PLATFORM_ADMINISTRATOR'], description: '平台管理员的权限投影，不代表目标组织的实际角色成员资格' })
  kind!: 'PLATFORM_ADMINISTRATOR';

  @ApiProperty({ type: [String], description: '显式 platform:admin 有效来源的内部组织 ID' })
  sourceOrganizationIds!: string[];

  @ApiProperty({ format: 'uuid', description: '本次权限预览的目标组织 ID；角色本身仍保留真实来源组织' })
  targetOrganizationId!: string;

  @ApiProperty({ enum: ['INTERNAL_PLATFORM'], description: '覆盖全部活跃内部组织的已注册、实际可用适用权限；停用内部组织仅保留组织查看、管理和审计读取/导出，不含业务权限或供应商范围' })
  coverage!: 'INTERNAL_PLATFORM';
}
