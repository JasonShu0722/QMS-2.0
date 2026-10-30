import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditEventDto } from '../audit-log/audit-query.dto.js';
import { ConsoleContextDto } from '../identity/dto/console-context.dto.js';

export const CONSOLE_HOME_SOURCE_KEYS = ['outbox', 'audit', 'reconfiguration-organizations', 'reconfiguration-departments', 'reconfiguration-positions', 'reconfiguration-users'] as const;

export class ConsoleHomeSourceDto {
  @ApiProperty({ enum: CONSOLE_HOME_SOURCE_KEYS })
  key!: (typeof CONSOLE_HOME_SOURCE_KEYS)[number];

  @ApiProperty({ enum: ['TARGET', 'SESSION_HOME'] })
  scope!: 'TARGET' | 'SESSION_HOME';

  @ApiProperty({ enum: ['ORGANIZATION', 'PLATFORM'], description: '平台目录的 organizationId 是授权来源，不是全部资源归属。' })
  coverage!: 'ORGANIZATION' | 'PLATFORM';

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ enum: ['AVAILABLE', 'UNAVAILABLE'] })
  status!: 'AVAILABLE' | 'UNAVAILABLE';

  @ApiProperty({ format: 'date-time', description: '该来源本次查询结束时间，不表示各来源属于同一原子快照或实时观测。' })
  completedAt!: string;

  @ApiPropertyOptional({ minimum: 0, description: '仅成功的事项来源提供拥有者统计总量；不可用或无权时不返回零值。' })
  total?: number;

  @ApiPropertyOptional({ type: [AuditEventDto], description: '仅成功的审计来源提供最近获授权事件，最多五条。' })
  items?: AuditEventDto[];

  @ApiPropertyOptional({ enum: ['SOURCE_UNAVAILABLE', 'AUTHORIZATION_CHANGED'], description: '授权变化需重新核验；不披露底层错误。' })
  reasonCode?: 'SOURCE_UNAVAILABLE' | 'AUTHORIZATION_CHANGED';
}

export class ConsoleHomeDto {
  @ApiProperty({ type: ConsoleContextDto })
  context!: ConsoleContextDto;

  @ApiProperty({ format: 'date-time', description: '服务器本次组合查询结束时间；不代表系统整体健康或实时状态。' })
  asOf!: string;

  @ApiProperty({ type: [ConsoleHomeSourceDto], description: '仅包含当前有权且有公开汇总来源的事项；空数组不等于全部管理事项为零。' })
  sources!: ConsoleHomeSourceDto[];
}
