import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { CreatePositionCategoryDto, NOTIFICATION_KINDS, type NotificationKind, type NotificationRuleDto, type PlatformSettingsDto, UpdateNotificationRuleDto, UpdatePlatformSettingsDto, UpdatePositionCategoryDto } from './platform-configuration.dto.js';
import { DEFAULT_PLATFORM_SETTINGS, defaultNotificationRule, validateNotificationTemplate } from './notification-content.js';

const categorySelect = { id: true, code: true, name: true, status: true, sortOrder: true, version: true } as const;

@Injectable()
export class PlatformConfigurationService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  settings(actor: AdminActor, organizationId: string): Promise<PlatformSettingsDto> {
    return this.read(actor, organizationId, async (transaction) => {
      const settings = await transaction.platformSettings.findUnique({ where: { organizationId }, select: { notificationLocale: true, exportRetentionMinutes: true, version: true } });
      return settings ? { ...settings, notificationLocale: settings.notificationLocale as 'zh-CN' | 'en-US' } : DEFAULT_PLATFORM_SETTINGS;
    });
  }

  async updateSettings(actor: AdminActor, organizationId: string, dto: UpdatePlatformSettingsDto, traceId: string, key?: string) {
    if (!['zh-CN', 'en-US'].includes(dto.notificationLocale) || !Number.isInteger(dto.exportRetentionMinutes) || dto.exportRetentionMinutes < 5 || dto.exportRetentionMinutes > 10080) throw new BadRequestException();
    return this.mutate(actor, organizationId, 'PLATFORM_SETTINGS_UPDATED', dto, traceId, key, async (transaction) => {
      const data = { notificationLocale: dto.notificationLocale, exportRetentionMinutes: dto.exportRetentionMinutes };
      if (dto.expectedVersion === 0) await transaction.platformSettings.create({ data: { organizationId, ...data } });
      else {
        const changed = await transaction.platformSettings.updateMany({ where: { organizationId, version: dto.expectedVersion }, data: { ...data, version: { increment: 1 } } });
        if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      }
      const result = await transaction.platformSettings.findUniqueOrThrow({ where: { organizationId }, select: { notificationLocale: true, exportRetentionMinutes: true, version: true } });
      await this.record(transaction, actor, organizationId, 'PLATFORM_SETTINGS_UPDATED', organizationId, result.version, traceId);
      return result;
    });
  }

  rules(actor: AdminActor, organizationId: string): Promise<NotificationRuleDto[]> {
    return this.read(actor, organizationId, async (transaction) => {
      const [settings, rules] = await Promise.all([transaction.platformSettings.findUnique({ where: { organizationId } }), transaction.notificationRule.findMany({ where: { organizationId } })]);
      return NOTIFICATION_KINDS.map((kind) => {
        const rule = rules.find((entry) => entry.kind === kind) ?? defaultNotificationRule(kind, settings?.notificationLocale ?? 'zh-CN');
        return { kind, enabled: rule.enabled, subjectTemplate: rule.subjectTemplate, bodyTemplate: rule.bodyTemplate, version: rule.version };
      });
    });
  }

  async updateRule(actor: AdminActor, organizationId: string, kind: NotificationKind, dto: UpdateNotificationRuleDto, traceId: string, key?: string) {
    if (!NOTIFICATION_KINDS.includes(kind)) throw new BadRequestException();
    validateNotificationTemplate(dto.subjectTemplate, 255);
    validateNotificationTemplate(dto.bodyTemplate, 2000);
    return this.mutate(actor, organizationId, 'NOTIFICATION_RULE_UPDATED', { kind, ...dto }, traceId, key, async (transaction) => {
      const data = { enabled: dto.enabled, subjectTemplate: dto.subjectTemplate, bodyTemplate: dto.bodyTemplate };
      if (dto.expectedVersion === 0) await transaction.notificationRule.create({ data: { organizationId, kind, ...data } });
      else {
        const changed = await transaction.notificationRule.updateMany({ where: { organizationId, kind, version: dto.expectedVersion }, data: { ...data, version: { increment: 1 } } });
        if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      }
      const result = await transaction.notificationRule.findUniqueOrThrow({ where: { organizationId_kind: { organizationId, kind } } });
      await this.record(transaction, actor, organizationId, 'NOTIFICATION_RULE_UPDATED', result.id, result.version, traceId);
      return { kind, enabled: result.enabled, subjectTemplate: result.subjectTemplate, bodyTemplate: result.bodyTemplate, version: result.version };
    });
  }

  categories(actor: AdminActor, organizationId: string) {
    return this.read(actor, organizationId, (transaction) => transaction.positionCategory.findMany({ where: { organizationId }, select: categorySelect, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], take: 1000 }));
  }

  createCategory(actor: AdminActor, organizationId: string, dto: CreatePositionCategoryDto, traceId: string, key?: string) {
    return this.mutate(actor, organizationId, 'POSITION_CATEGORY_CREATED', dto, traceId, key, async (transaction) => {
      if (await transaction.positionCategory.count({ where: { organizationId } }) >= 1000) throw new BadRequestException();
      const result = await transaction.positionCategory.create({ data: { ...dto, name: dto.name.trim(), organizationId }, select: categorySelect });
      await this.record(transaction, actor, organizationId, 'POSITION_CATEGORY_CREATED', result.id, result.version, traceId);
      return result;
    });
  }

  updateCategory(actor: AdminActor, organizationId: string, id: string, dto: UpdatePositionCategoryDto, traceId: string, key?: string) {
    return this.mutate(actor, organizationId, 'POSITION_CATEGORY_UPDATED', { id, ...dto }, traceId, key, async (transaction) => {
      const changed = await transaction.positionCategory.updateMany({ where: { id, organizationId, version: dto.expectedVersion }, data: { name: dto.name?.trim(), status: dto.status, sortOrder: dto.sortOrder, version: { increment: 1 } } });
      if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      const result = await transaction.positionCategory.findUniqueOrThrow({ where: { id }, select: categorySelect });
      await this.record(transaction, actor, organizationId, 'POSITION_CATEGORY_UPDATED', id, result.version, traceId);
      return result;
    });
  }

  private read<Result>(actor: AdminActor, organizationId: string, work: (transaction: AdminTransaction) => Promise<Result>): Promise<Result> {
    return this.prisma.$transaction(async (transaction) => { await assertAdminAccess(transaction, actor, organizationId, 'configuration:read'); return work(transaction); });
  }

  private mutate<Result>(actor: AdminActor, organizationId: string, action: string, payload: object, traceId: string, key: string | undefined, work: (transaction: AdminTransaction) => Promise<Result>) {
    return this.mutations.run({ actor, organizationId, action, payload: { organizationId, ...payload }, permission: 'configuration:manage', traceId, key }, work);
  }

  private record(transaction: AdminTransaction, actor: AdminActor, organizationId: string, action: string, resourceId: string, version: number, traceId: string) {
    return this.audit.record({ actorUserId: actor.id, organizationId, action, resourceType: 'PlatformConfiguration', resourceId, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: version } }, transaction);
  }
}
