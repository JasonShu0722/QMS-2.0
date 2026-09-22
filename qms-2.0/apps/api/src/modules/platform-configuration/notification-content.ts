import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { NotificationKind } from './platform-configuration.dto.js';

export const DEFAULT_PLATFORM_SETTINGS = { notificationLocale: 'zh-CN' as const, exportRetentionMinutes: 1440, version: 0 };
const placeholders = new Set(['reportNumber', 'nodeName', 'dueAt']);

export function validateNotificationTemplate(template: string, maximum: number) {
  if (typeof template !== 'string' || !template.trim() || template.length > maximum || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(template)) throw new BadRequestException();
  const remainder = template.replace(/\{\{([A-Za-z]+)\}\}/g, (_match, key: string) => {
    if (!placeholders.has(key)) throw new BadRequestException();
    return '';
  });
  if (remainder.includes('{{') || remainder.includes('}}')) throw new BadRequestException();
}

export function defaultNotificationRule(kind: NotificationKind, locale: string) {
  const english = locale === 'en-US';
  return {
    kind, enabled: true, version: 0,
    subjectTemplate: kind === 'TASK_ASSIGNED' ? '{{nodeName}}' : kind === 'TASK_REMINDER' ? `${english ? 'Reminder: ' : '时限提醒：'}{{nodeName}}` : `${english ? 'Overdue escalation: ' : '超时升级：'}{{nodeName}}`,
    bodyTemplate: kind === 'TASK_ASSIGNED' ? '{{reportNumber}}: {{nodeName}}' : `{{reportNumber}}: {{nodeName}}${english ? ', due ' : '，截止时间 '}{{dueAt}}`,
  };
}

export async function notificationContent(transaction: Pick<Prisma.TransactionClient, 'platformSettings' | 'notificationRule'>, organizationId: string, kind: NotificationKind, values: { reportNumber: string; nodeName: string; dueAt: string }) {
  const [settings, configured] = await Promise.all([
    transaction.platformSettings.findUnique({ where: { organizationId } }),
    transaction.notificationRule.findUnique({ where: { organizationId_kind: { organizationId, kind } } }),
  ]);
  const rule = configured ?? defaultNotificationRule(kind, settings?.notificationLocale ?? 'zh-CN');
  if (!rule.enabled) return null;
  validateNotificationTemplate(rule.subjectTemplate, 255);
  validateNotificationTemplate(rule.bodyTemplate, 2000);
  const render = (template: string) => template.replace(/\{\{([A-Za-z]+)\}\}/g, (_match, key: keyof typeof values) => values[key]);
  return { kind, ruleVersion: rule.version, subject: render(rule.subjectTemplate).slice(0, 255), body: render(rule.bodyTemplate).slice(0, 2000) };
}
