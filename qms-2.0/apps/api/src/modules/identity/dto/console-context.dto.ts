import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ConsoleContextQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  organizationId?: string;
}

export class ConsoleOrganizationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  code!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ enum: ['INTERNAL', 'SUPPLIER'] })
  type!: 'INTERNAL' | 'SUPPLIER';
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  status!: 'ACTIVE' | 'DISABLED';
  @ApiProperty()
  configurationRequired!: boolean;
}

export class ConsoleActorDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: ['INTERNAL'] })
  accountType!: 'INTERNAL';
  @ApiProperty({ type: ConsoleOrganizationDto })
  homeOrganization!: ConsoleOrganizationDto;
}

export const CONSOLE_MODULE_KEYS = ['users', 'organizations', 'master-data', 'configuration', 'workflows', 'audit', 'outbox', 'reconfiguration', 'problem-reconfiguration', 'supplier-accounts'] as const;

export class ConsoleModuleDto {
  @ApiProperty({ enum: CONSOLE_MODULE_KEYS })
  key!: (typeof CONSOLE_MODULE_KEYS)[number];
  @ApiProperty({ enum: ['TARGET', 'SESSION_HOME'], description: '导航范围，不替代各业务 API 的实时授权。' })
  scope!: 'TARGET' | 'SESSION_HOME';
  @ApiProperty({ enum: ['ORGANIZATION', 'PLATFORM'], description: '资源覆盖范围；平台级目录不表示所有资源属于会话组织。' })
  coverage!: 'ORGANIZATION' | 'PLATFORM';
  @ApiProperty({ format: 'uuid', description: '权限或查询范围的组织来源；不是平台级目录全部资源的归属组织。' })
  organizationId!: string;
  @ApiProperty({ type: [String] })
  permissions!: string[];
}

export class ConsoleContextDto {
  @ApiProperty({ type: ConsoleActorDto })
  actor!: ConsoleActorDto;
  @ApiProperty({ type: ConsoleOrganizationDto })
  targetOrganization!: ConsoleOrganizationDto;
  @ApiProperty({ type: [ConsoleOrganizationDto], description: '仅包含具有真实可用控制台能力的管理目标。' })
  organizations!: ConsoleOrganizationDto[];
  @ApiProperty()
  hasPlatformAdministrator!: boolean;
  @ApiProperty({ type: [ConsoleModuleDto] })
  modules!: ConsoleModuleDto[];
}
