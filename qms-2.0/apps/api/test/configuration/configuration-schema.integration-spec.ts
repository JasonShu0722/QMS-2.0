import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { PlatformConfigurationService } from '../../src/modules/platform-configuration/platform-configuration.service.js';
import { notificationContent } from '../../src/modules/platform-configuration/notification-content.js';
import { timingFixture, clearTimingEvents } from '../task-notification/workflow-timing-fixture.js';
import { WorkflowEventHandler } from '../../src/modules/task-notification/workflow-event.handler.js';
import { OutboxWorkerService } from '../../src/modules/task-notification/outbox-worker.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';

if (!process.env.DATABASE_URL) throw new Error('PostgreSQL integration requires DATABASE_URL');

describe('controlled platform configuration', () => {
  const prisma = new PrismaService(process.env.DATABASE_URL!);
  const organizationId = randomUUID();
  const userId = randomUUID();
  const actor = { id: userId, organizationId, sessionId: randomUUID(), accountType: 'INTERNAL' as const };
  const audit = new AuditLogService(prisma);
  const service = new PlatformConfigurationService(prisma, new AdminMutationService(prisma, audit), audit);
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.create({ data: { id: organizationId, code: organizationId, name: 'Configuration', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: userId, organizationId, username: userId, passwordHash: 'unused', accountType: 'INTERNAL' } });
    const role = await prisma.role.create({ data: { organizationId, code: 'CONFIG', name: 'Configuration' } });
    for (const code of ['configuration:read', 'configuration:manage']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { organizationId, userId, roleId: role.id } });
    await prisma.session.create({ data: { id: actor.sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), mfaVerifiedAt: new Date(), reauthenticatedAt: new Date() } });
  });
  afterAll(() => prisma.$disconnect());

  it('provides explicit defaults and validates versioned settings updates', async () => {
    expect(await service.settings(actor, organizationId)).toMatchObject({ notificationLocale: 'zh-CN', exportRetentionMinutes: 1440, version: 0 });
    const result = await service.updateSettings(actor, organizationId, { expectedVersion: 0, notificationLocale: 'en-US', exportRetentionMinutes: 60 }, 'config-test', randomUUID());
    expect(result).toMatchObject({ version: 1, notificationLocale: 'en-US' });
    await expect(service.updateSettings(actor, organizationId, { expectedVersion: 0, notificationLocale: 'zh-CN', exportRetentionMinutes: 60 }, 'config-test', randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('consumes locale and configured templates, freezes rule version, and suppresses disabled notifications', async () => {
    const values = { reportNumber: 'QMS-1', nodeName: 'Review', dueAt: '2026-01-01T00:00:00Z' };
    const defaultContent = await notificationContent(prisma, organizationId, 'TASK_REMINDER', values);
    expect(defaultContent?.subject).toContain('Reminder');
    const first = await service.updateRule(actor, organizationId, 'TASK_REMINDER', { expectedVersion: 0, enabled: true, subjectTemplate: '{{reportNumber}} / {{nodeName}}', bodyTemplate: 'Due: {{dueAt}}' }, 'config-test', randomUUID());
    expect(await notificationContent(prisma, organizationId, 'TASK_REMINDER', values)).toMatchObject({ subject: 'QMS-1 / Review', body: `Due: ${values.dueAt}`, kind: 'TASK_REMINDER', ruleVersion: first.version });
    await service.updateRule(actor, organizationId, 'TASK_REMINDER', { expectedVersion: first.version, enabled: false, subjectTemplate: first.subjectTemplate, bodyTemplate: first.bodyTemplate }, 'config-test', randomUUID());
    expect(await notificationContent(prisma, organizationId, 'TASK_REMINDER', values)).toBeNull();
  });

  it('rejects executable or unknown placeholders and unsafe setting values', async () => {
    for (const subjectTemplate of ['{{password}}', '<script>x</script>', '{{nodeName', '{{constructor}}']) await expect(service.updateRule(actor, organizationId, 'TASK_ASSIGNED', { expectedVersion: 0, enabled: true, subjectTemplate, bodyTemplate: 'valid' }, 'config-test', randomUUID())).rejects.toMatchObject({ status: 400 });
    await expect(service.updateSettings(actor, organizationId, { expectedVersion: 1, notificationLocale: 'en-US', exportRetentionMinutes: 0 }, 'config-test', randomUUID())).rejects.toMatchObject({ status: 400 });
  });

  it('maintains stable category codes, versioned status and tenant isolation', async () => {
    const category = await service.createCategory(actor, organizationId, { code: 'QUALITY', name: 'Quality', sortOrder: 1 }, 'config-test', randomUUID());
    expect(await service.updateCategory(actor, organizationId, category.id, { expectedVersion: category.version, name: 'Quality team', status: 'DISABLED', sortOrder: 2 }, 'config-test', randomUUID())).toMatchObject({ code: 'QUALITY', version: 2, status: 'DISABLED' });
    await expect(service.settings(actor, randomUUID())).rejects.toMatchObject({ status: 403 });
    await prisma.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
    try { await expect(service.settings(actor, organizationId)).rejects.toMatchObject({ status: 401 }); }
    finally { await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } }); }
  });

  it('consumes notification rules in the real worker without suppressing task and overdue effects', async () => {
    const organizationIds: string[] = [];
    const context = await timingFixture(prisma, organizationIds);
    try {
      for (const kind of ['TASK_ASSIGNED', 'TASK_REMINDER', 'TASK_ESCALATED']) await prisma.notificationRule.create({ data: { organizationId: context.organization.id, kind, enabled: false, subjectTemplate: '{{nodeName}}', bodyTemplate: '{{reportNumber}}' } });
      const handler = new WorkflowEventHandler();
      await new OutboxWorkerService(prisma, () => new Date()).processAtomicDue(100, handler);
      const task = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: context.started.instanceId } });
      expect(task.status).toBe('PENDING');
      expect(await prisma.notification.count({ where: { workflowTaskId: task.id } })).toBe(0);
      await new OutboxWorkerService(prisma, () => task.dueAt!).processAtomicDue(100, handler);
      expect(await prisma.workflowTask.findUnique({ where: { id: task.id } })).toMatchObject({ status: 'OVERDUE' });
      expect(await prisma.notification.count({ where: { workflowTaskId: task.id } })).toBe(0);
      expect(await prisma.outboxEvent.count({ where: { aggregateId: task.id, status: 'PROCESSED' } })).toBe(4);
    } finally { await clearTimingEvents(prisma, organizationIds); }
  });

  it('uses category values in positions and rejects foreign or disabled categories', async () => {
    const assignment = await prisma.userRole.findFirstOrThrow({ where: { userId } });
    const permission = await prisma.permission.upsert({ where: { code: 'organization:structure:manage' }, create: { code: 'organization:structure:manage', name: 'Structure' }, update: {} });
    await prisma.rolePermission.create({ data: { roleId: assignment.roleId, permissionId: permission.id } });
    const structures = new OrganizationService(prisma, new AdminMutationService(prisma, audit), audit, undefined as never);
    const department = await structures.createDepartment(actor, organizationId, { code: 'QA', name: 'QA' }, 'config-test', randomUUID());
    const category = await service.createCategory(actor, organizationId, { code: 'ENGINEERING', name: 'Engineering', sortOrder: 0 }, 'config-test', randomUUID());
    const position = await structures.createPosition(actor, organizationId, { code: 'QE', name: 'Engineer', departmentId: department.id, categoryId: category.id }, 'config-test', randomUUID());
    expect(position).toMatchObject({ categoryId: category.id });
    await expect(structures.updatePosition(actor, organizationId, position.id, { expectedVersion: 1, status: 'DISABLED' }, 'config-test', randomUUID())).rejects.toMatchObject({ status: 403 });
    expect(await prisma.position.findUniqueOrThrow({ where: { id: position.id } })).toMatchObject({ status: 'ACTIVE', version: 1 });
    for (const code of ['account:roles:read', 'account:roles:assign']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: assignment.roleId, permissionId: permission.id } });
    }
    await structures.updatePosition(actor, organizationId, position.id, { expectedVersion: 1, status: 'DISABLED' }, 'config-test', randomUUID());
    await service.updateCategory(actor, organizationId, category.id, { expectedVersion: 1, status: 'DISABLED' }, 'config-test', randomUUID());
    await expect(structures.updatePosition(actor, organizationId, position.id, { expectedVersion: 2, status: 'ACTIVE' }, 'config-test', randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(await structures.updatePosition(actor, organizationId, position.id, { expectedVersion: 2, status: 'ACTIVE', categoryId: null }, 'config-test', randomUUID())).toMatchObject({ categoryId: null, status: 'ACTIVE' });
    for (const categoryId of [category.id, randomUUID()]) await expect(structures.createPosition(actor, organizationId, { code: randomUUID(), name: 'Engineer', departmentId: department.id, categoryId }, 'config-test', randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('persists configured text and rule version and keeps historical notifications frozen', async () => {
    const organizationIds: string[] = [];
    const context = await timingFixture(prisma, organizationIds, { slaMinutes: undefined, reminders: undefined, escalation: undefined });
    try {
      const rule = await prisma.notificationRule.create({ data: { organizationId: context.organization.id, kind: 'TASK_ASSIGNED', enabled: true, subjectTemplate: 'Review {{reportNumber}}', bodyTemplate: '{{nodeName}}', version: 3 } });
      const worker = new OutboxWorkerService(prisma, () => new Date());
      await worker.processAtomicDue(100, new WorkflowEventHandler());
      const original = await prisma.notification.findFirstOrThrow({ where: { organizationId: context.organization.id } });
      expect(original).toMatchObject({ kind: 'TASK_ASSIGNED', ruleVersion: 3, subject: `Review ${context.problem.reportNumber}`, body: 'Handle' });
      await prisma.notificationRule.update({ where: { id: rule.id }, data: { subjectTemplate: 'Changed', version: 4 } });
      await prisma.outboxEvent.updateMany({ where: { aggregateId: context.started.instanceId }, data: { status: 'PENDING', processedAt: null } });
      await worker.processAtomicDue(100, new WorkflowEventHandler());
      expect(await prisma.notification.findMany({ where: { organizationId: context.organization.id } })).toEqual([original]);
    } finally { await clearTimingEvents(prisma, organizationIds); }
  });

  it('rolls back configuration updates when success audit is unavailable', async () => {
    const before = await service.settings(actor, organizationId);
    const failingAudit = { record: async () => { throw new Error('audit unavailable'); } };
    const failure = new PlatformConfigurationService(prisma, new AdminMutationService(prisma, audit), failingAudit as never);
    await expect(failure.updateSettings(actor, organizationId, { expectedVersion: before.version, notificationLocale: 'zh-CN', exportRetentionMinutes: 5 }, 'config-test', randomUUID())).rejects.toThrow();
    expect(await service.settings(actor, organizationId)).toEqual(before);
  });

  it('protects configuration HTTP routes and rejects unknown fields', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    try {
      const token = await app.get(SessionService).create(userId, prisma, { mfaVerified: true, reauthenticated: true });
      const cookie = `qms_session=${token}; qms_csrf=configuration-csrf`;
      const path = '/api/v1/admin/configuration/settings';
      await request(app.getHttpServer()).get(path).expect(401);
      const current = await request(app.getHttpServer()).get(path).set('Cookie', cookie).expect(200);
      const body = { expectedVersion: current.body.version, notificationLocale: 'zh-CN', exportRetentionMinutes: 60 };
      await request(app.getHttpServer()).patch(path).set('Cookie', cookie).send(body).expect(403);
      await request(app.getHttpServer()).patch(path).set('Cookie', cookie).set('x-csrf-token', 'configuration-csrf').set('Idempotency-Key', randomUUID()).send({ ...body, databasePassword: 'forbidden' }).expect(400);
      await request(app.getHttpServer()).patch(path).set('Cookie', cookie).set('x-csrf-token', 'configuration-csrf').set('Idempotency-Key', randomUUID()).send(body).expect(200);
      await request(app.getHttpServer()).patch(path).set('Cookie', cookie).set('x-csrf-token', 'configuration-csrf').set('Idempotency-Key', randomUUID()).send(body).expect(409);
    } finally { await app.close(); }
  });
});
