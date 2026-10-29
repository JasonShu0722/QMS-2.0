import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createDisposableAppDatabase } from '../disposable-app-database.js';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { NotificationService } from '../../src/modules/task-notification/notification.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { OUTBOX_HANDLER, OutboxWorkerService, runConfiguredWorker, type OutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import { SupplierPortalNotificationService } from '../../src/modules/task-notification/supplier-portal-notification.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';

if (!process.env.DATABASE_URL) throw new Error('Supplier notification integration requires real PostgreSQL; no skipping.');

describe('supplier workflow notifications on PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: OutboxWorkerService;
  let handler: OutboxHandler;
  let notifications: NotificationService;
  let portalNotifications: SupplierPortalNotificationService;
  const csrf = randomUUID();
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = await createDisposableAppDatabase('qms_supplier_notification');
  }, 120000);

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).not.toBe(originalDatabaseUrl);
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    worker = app.get(OutboxWorkerService);
    handler = app.get(OUTBOX_HANDLER);
    notifications = app.get(NotificationService);
    portalNotifications = app.get(SupplierPortalNotificationService);
  });

  afterAll(async () => {
    try { await app?.close(); }
    finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  async function fixture() {
    const owner = await prisma.organization.create({ data: { code: randomUUID(), name: 'Supplier notification owner', type: 'INTERNAL' } });
    const supplier = await prisma.organization.create({ data: { code: randomUUID(), name: 'Assigned supplier', type: 'SUPPLIER' } });
    const outsider = await prisma.organization.create({ data: { code: randomUUID(), name: 'Other supplier', type: 'SUPPLIER' } });
    const ownerUser = await prisma.user.create({ data: { organizationId: owner.id, username: randomUUID(), passwordHash: 'fixture', accountType: 'INTERNAL' } });
    const supplierUser = await prisma.user.create({ data: { organizationId: supplier.id, username: randomUUID(), passwordHash: 'fixture', accountType: 'SUPPLIER' } });
    const outsiderUser = await prisma.user.create({ data: { organizationId: outsider.id, username: randomUUID(), passwordHash: 'fixture', accountType: 'SUPPLIER' } });
    let supplierRoleId = '';
    for (const [organization, user, codes] of [
      [owner, ownerUser, ['workflow:start', 'workflow:act']],
      [supplier, supplierUser, ['workflow:act', 'supplier-quality:responses:read', 'supplier-quality:responses:write', 'notification:read']],
      [outsider, outsiderUser, ['workflow:act', 'supplier-quality:responses:read', 'supplier-quality:responses:write', 'notification:read']],
    ] as const) {
      const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Workflow recipient' } });
      if (organization.id === supplier.id) supplierRoleId = role.id;
      for (const code of codes) {
        const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      }
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: organization.id } });
    }
    const supplierToken = await app.get(SessionService).create(supplierUser.id, prisma, { mfaVerified: true, reauthenticated: true });
    const outsiderToken = await app.get(SessionService).create(outsiderUser.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = await prisma.session.findFirstOrThrow({ where: { userId: supplierUser.id }, orderBy: { createdAt: 'desc' } });
    const profile = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: owner.id, supplierOrganizationId: supplier.id, businessCode: randomUUID(), displayName: supplier.name } });
    const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), new AuditLogService(prisma));
    const definition = await definitions.createDraft({ organizationId: owner.id, userId: ownerUser.id, code: randomUUID(), name: 'Supplier notification flow', draft: {
      nodes: [
        { id: 'reply', name: 'Supplier reply', type: 'ACTION', config: { isStart: true, slaMinutes: 2, reminders: [{ offsetMinutes: 1 }], assignment: { permission: 'supplier-quality:responses:write' } } },
        { id: 'verify', name: 'Internal verify', type: 'VERIFICATION', config: { assignment: { permission: 'workflow:act' } } },
        { id: 'close', name: 'Close', type: 'CLOSE', config: { isEnd: true, assignment: { permission: 'workflow:act' } } },
      ], transitions: [{ id: 'submit', from: 'reply', to: 'verify', action: 'SUBMIT' }, { id: 'verify', from: 'verify', to: 'close', action: 'VERIFY' }],
    } });
    const version = await definitions.publishVersion({ organizationId: owner.id, userId: ownerUser.id, definitionId: definition.id });
    const record = await prisma.supplierQualityProblem.create({ data: {
      ownerOrganizationId: owner.id, supplierOrganizationId: supplier.id, profileId: profile.id, title: 'Supplier reply requested',
      materialCode: 'MAT-TEST', defectDescription: 'Batch defect', defectQuantity: 2, severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER',
      createdById: ownerUser.id,
    } });
    const index = await prisma.problemIndex.create({ data: { organizationId: owner.id, reportNumber: randomUUID(), domainCode: 'supplier-quality', sourceType: 'supplier-quality', sourceId: record.id, problemType: 'BRIEF', severity: 'HIGH' } });
    await prisma.supplierQualityProblem.update({ where: { id: record.id }, data: { problemIndexId: index.id, releasedToSupplierAt: new Date() } });
    const audit = new AuditLogService(prisma);
    const outbox = new OutboxService(prisma);
    const runtime = new WorkflowRuntimeService(prisma, audit, outbox, new ProblemIndexService(prisma, new NumberingService(prisma), audit, outbox));
    const started = await runtime.startInstance({ organizationId: owner.id, actor: { id: ownerUser.id, organizationId: owner.id, accountType: 'INTERNAL' }, problemIndexId: index.id,
      workflowDefinitionId: definition.id, workflowVersionId: version.id, expectedProblemVersion: 1, instanceKey: record.id, idempotencyKey: randomUUID(), traceId: randomUUID() });
    const startEvent = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `workflow:${started.instanceId}:1` } });
    return { owner, supplier, outsider, supplierUser, outsiderUser, supplierRoleId, session, index, started, startEvent,
      supplierCookie: `qms_session=${supplierToken}; qms_csrf=${csrf}`, outsiderCookie: `qms_session=${outsiderToken}; qms_csrf=${csrf}` };
  }

  it('routes assignment and reminder to the released supplier, supports scoped inbox and deduplicates replay', async () => {
    const context = await fixture();
    const eventTime = new Date(Date.now() - 90_000);
    await prisma.outboxEvent.update({ where: { id: context.startEvent.id }, data: { createdAt: eventTime } });
    await runConfiguredWorker(worker, handler);
    expect(await prisma.outboxEvent.findUnique({ where: { id: context.startEvent.id } })).toMatchObject({ status: 'PROCESSED' });
    const task = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: context.started.instanceId } });
    expect(task.organizationId).toBe(context.owner.id);
    expect(task.dueAt).toEqual(new Date(eventTime.getTime() + 120_000));
    expect(await prisma.supplierPortalNotification.findMany({ where: { workflowTaskId: task.id } })).toMatchObject([{
      ownerOrganizationId: context.owner.id, supplierOrganizationId: context.supplier.id, recipientUserId: context.supplierUser.id, kind: 'TASK_ASSIGNED',
    }]);
    expect(await prisma.notification.findMany({ where: { workflowTaskId: task.id } })).toEqual([]);
    const actor = { id: context.supplierUser.id, organizationId: context.supplier.id, accountType: 'SUPPLIER' as const, sessionId: context.session.id };
    expect((await portalNotifications.list(actor, {})).items).toHaveLength(1);
    expect((await notifications.list(actor, {})).items).toHaveLength(0);
    const inbox = await request(app.getHttpServer()).get('/api/v1/supplier-portal/notifications').set('Cookie', context.supplierCookie).expect(200);
    expect(inbox.body.items).toHaveLength(1);
    expect((await request(app.getHttpServer()).get('/api/v1/supplier-portal/notifications').set('Cookie', context.outsiderCookie).expect(200)).body.items).toHaveLength(0);
    const read = await request(app.getHttpServer()).post(`/api/v1/supplier-portal/notifications/${inbox.body.items[0].id}/read`)
      .set('Cookie', context.supplierCookie).set('x-csrf-token', csrf).send({ expectedVersion: 1 }).expect(201);
    expect(read.body).toMatchObject({ id: inbox.body.items[0].id, version: 2 });
    await request(app.getHttpServer()).post(`/api/v1/supplier-portal/notifications/${inbox.body.items[0].id}/read`)
      .set('Cookie', context.outsiderCookie).set('x-csrf-token', csrf).send({ expectedVersion: 1 }).expect(404);
    await runConfiguredWorker(worker, handler);
    expect(await prisma.supplierPortalNotification.count({ where: { workflowTaskId: task.id } })).toBe(2);
    const reminder = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `workflow-task:${task.id}:reminder:1` } });
    await prisma.outboxEvent.update({ where: { id: reminder.id }, data: { status: 'PENDING', processedAt: null } });
    await runConfiguredWorker(worker, handler);
    await prisma.outboxEvent.update({ where: { id: context.startEvent.id }, data: { status: 'PENDING', processedAt: null } });
    await runConfiguredWorker(worker, handler);
    expect(await prisma.supplierPortalNotification.count({ where: { workflowTaskId: task.id } })).toBe(2);
    expect(await prisma.notification.count({ where: { organizationId: context.owner.id, workflowTaskId: task.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { organizationId: context.outsider.id, workflowTaskId: task.id } })).toBe(0);
    await expect(notifications.list(actor, { organizationId: context.owner.id })).rejects.toMatchObject({ status: 403 });
  });

  it('keeps the global notification foreign keys and separately enforces both portal foreign keys', async () => {
    const context = await fixture();
    await runConfiguredWorker(worker, handler);
    expect(await prisma.outboxEvent.findUnique({ where: { id: context.startEvent.id } })).toMatchObject({ status: 'PROCESSED' });
    const task = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: context.started.instanceId } });
    await expect(prisma.notification.create({ data: { organizationId: context.supplier.id, recipientUserId: context.supplierUser.id, workflowTaskId: task.id, channel: 'IN_APP', kind: 'TASK_ASSIGNED', status: 'DELIVERED', body: 'test' } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.notification.create({ data: { organizationId: context.owner.id, recipientUserId: context.supplierUser.id, workflowTaskId: task.id, channel: 'IN_APP', kind: 'TASK_ASSIGNED', status: 'DELIVERED', body: 'test' } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.supplierPortalNotification.create({ data: { eventKey: randomUUID(), ownerOrganizationId: context.supplier.id,
      supplierOrganizationId: context.supplier.id, recipientUserId: context.supplierUser.id, supplierProblemId: context.index.sourceId!, workflowTaskId: task.id,
      kind: 'TASK_ASSIGNED', body: 'test' } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.supplierPortalNotification.create({ data: { eventKey: randomUUID(), ownerOrganizationId: context.owner.id,
      supplierOrganizationId: context.owner.id, recipientUserId: context.supplierUser.id, supplierProblemId: context.index.sourceId!, workflowTaskId: task.id,
      kind: 'TASK_ASSIGNED', body: 'test' } })).rejects.toMatchObject({ code: 'P2003' });
    expect(await prisma.notification.count({ where: { workflowTaskId: task.id } })).toBe(0);
  });

  it('does not deliver for a closed problem even when its start event remains pending', async () => {
    const context = await fixture();
    await prisma.problemIndex.update({ where: { id: context.index.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    await runConfiguredWorker(worker, handler);
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(1);
    expect(await prisma.supplierPortalNotification.count({ where: { workflowTask: { workflowInstanceId: context.started.instanceId } } })).toBe(0);
  });

  it('consumes a pending reminder without delivery after closure or supplier permission revocation', async () => {
    const context = await fixture();
    await prisma.outboxEvent.update({ where: { id: context.startEvent.id }, data: { createdAt: new Date(Date.now() - 90_000) } });
    await runConfiguredWorker(worker, handler);
    const task = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: context.started.instanceId } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:responses:write' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: context.supplierRoleId, permissionId: permission.id } } });
    await prisma.problemIndex.update({ where: { id: context.index.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    await runConfiguredWorker(worker, handler);
    expect(await prisma.outboxEvent.findUnique({ where: { eventKey: `workflow-task:${task.id}:reminder:1` } })).toMatchObject({ status: 'PROCESSED', attempts: 0 });
    expect(await prisma.supplierPortalNotification.count({ where: { workflowTaskId: task.id } })).toBe(1);
    const actor = { id: context.supplierUser.id, organizationId: context.supplier.id, accountType: 'SUPPLIER' as const, sessionId: context.session.id };
    expect((await portalNotifications.list(actor, {})).items).toHaveLength(0);
  });

  it('hides delivered notices immediately after permission revocation', async () => {
    const context = await fixture();
    await runConfiguredWorker(worker, handler);
    const actor = { id: context.supplierUser.id, organizationId: context.supplier.id, accountType: 'SUPPLIER' as const, sessionId: context.session.id };
    expect((await portalNotifications.list(actor, {})).items).toHaveLength(1);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:responses:write' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: context.supplierRoleId, permissionId: permission.id } } });
    expect((await portalNotifications.list(actor, {})).items).toHaveLength(0);
    expect((await request(app.getHttpServer()).get('/api/v1/supplier-portal/notifications').set('Cookie', context.supplierCookie).expect(200)).body.items).toHaveLength(0);
  });

  it('does not create a notice if the supplier reply permission is revoked before Worker delivery', async () => {
    const context = await fixture();
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:responses:write' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: context.supplierRoleId, permissionId: permission.id } } });
    await runConfiguredWorker(worker, handler);
    expect(await prisma.outboxEvent.findUnique({ where: { id: context.startEvent.id } })).toMatchObject({ status: 'PROCESSED', attempts: 0 });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(1);
    expect(await prisma.supplierPortalNotification.count({ where: { supplierProblemId: context.index.sourceId! } })).toBe(0);
  });

  it('does not notify an unreleased supplier problem', async () => {
    const context = await fixture();
    await prisma.supplierQualityProblem.update({ where: { id: context.index.sourceId! }, data: { releasedToSupplierAt: null } });
    await runConfiguredWorker(worker, handler);
    expect(await prisma.outboxEvent.findUnique({ where: { id: context.startEvent.id } })).toMatchObject({ status: 'PROCESSED', attempts: 0 });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(1);
    expect(await prisma.supplierPortalNotification.count({ where: { supplierProblemId: context.index.sourceId! } })).toBe(0);
  });

  it.each(['missing-domain', 'disabled-supplier'] as const)('retries invalid notification invariants: %s', async (failure) => {
    const context = await fixture();
    if (failure === 'missing-domain') await prisma.problemIndex.update({ where: { id: context.index.id }, data: { sourceId: null } });
    else await prisma.organization.update({ where: { id: context.supplier.id }, data: { status: 'DISABLED' } });
    await runConfiguredWorker(worker, handler);
    expect(await prisma.outboxEvent.findUnique({ where: { id: context.startEvent.id } })).toMatchObject({
      status: 'PENDING', attempts: 1, lastError: failure === 'missing-domain' ? 'SUPPLIER_NOTIFICATION_RESOURCE_INVALID' : 'SUPPLIER_NOTIFICATION_ORGANIZATION_INVALID',
    });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(0);
    expect(await prisma.supplierPortalNotification.count({ where: { supplierProblemId: context.index.sourceId! } })).toBe(0);
  });

  it('rolls back the task and portal notice together, then recovers on Worker retry', async () => {
    const context = await fixture();
    const functionName = `fail_supplier_notice_${randomUUID().replaceAll('-', '')}`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'supplier notice fault'; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${functionName} BEFORE INSERT ON supplier_portal_notifications FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    try {
      await runConfiguredWorker(worker, handler);
      expect(await prisma.outboxEvent.findUnique({ where: { id: context.startEvent.id } })).toMatchObject({ status: 'PENDING', attempts: 1 });
      expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(0);
      expect(await prisma.supplierPortalNotification.count({ where: { supplierProblemId: context.index.sourceId! } })).toBe(0);
      expect(await prisma.workflowInstance.findUnique({ where: { id: context.started.instanceId } })).toMatchObject({ taskProjectionVersion: 0 });
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${functionName} ON supplier_portal_notifications`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${functionName}()`);
    }
    await prisma.outboxEvent.update({ where: { id: context.startEvent.id }, data: { availableAt: new Date(0) } });
    await runConfiguredWorker(worker, handler);
    expect(await prisma.outboxEvent.findUnique({ where: { id: context.startEvent.id } })).toMatchObject({ status: 'PROCESSED', attempts: 1 });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(1);
    expect(await prisma.supplierPortalNotification.count({ where: { supplierProblemId: context.index.sourceId! } })).toBe(1);
  });

  it('projects the released supplier notice through the compiled Worker process', async () => {
    const context = await fixture();
    const child = spawn(process.execPath, ['dist/worker.js', '--once'], {
      cwd: process.cwd(), windowsHide: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    expect(exitCode).toBe(0);
    expect(await prisma.outboxEvent.findUnique({ where: { id: context.startEvent.id } })).toMatchObject({ status: 'PROCESSED' });
    expect(await prisma.supplierPortalNotification.findMany({ where: { supplierProblemId: context.index.sourceId! } })).toMatchObject([{
      ownerOrganizationId: context.owner.id, supplierOrganizationId: context.supplier.id, recipientUserId: context.supplierUser.id, kind: 'TASK_ASSIGNED',
    }]);
  }, 30_000);
});
