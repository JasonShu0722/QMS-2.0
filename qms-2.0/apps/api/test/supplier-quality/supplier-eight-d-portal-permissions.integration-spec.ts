import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { assignSupplierPortalRole, assertSupplierAccountTarget } from '../../src/modules/authorization/supplier-account-authorization.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { APPLICATION_OUTBOX_HANDLER, OutboxWorkerService, type AtomicOutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDFixture } from './supplier-eight-d.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Portal permission check requires disposable loopback PostgreSQL, never preview 55440.');

describe('supplier inbox with the actual supported portal-role boundary', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter()); await app.init();
    // Existing accepted events belong to fixture setup, not this case's timed permission checks.
    await drainAcceptedEvents();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  async function drainAcceptedEvents() {
    const handler = app.get<AtomicOutboxHandler>(APPLICATION_OUTBOX_HANDLER);
    const count = await app.get(PrismaService).outboxEvent.count({ where: { status: 'PENDING', eventType: { in: [...handler.eventTypes] } } });
    for (let batch = 0; batch <= Math.ceil(count / 100); batch++) await app.get(OutboxWorkerService).processAtomicDue(100, handler);
  }

  it('lists and notifies a legitimate external responder without giving it internal task permissions', async () => {
    const f = await supplierEightDFixture(app);
    await f.db.$transaction(tx => assignSupplierPortalRole(tx, f.vendor.org.id, f.vendor.user.id));
    await f.db.$transaction(tx => assertSupplierAccountTarget(tx, f.sqe.actor, f.vendor.org.id, f.vendor.user.id, 'account:users:create'));
    const taskPermission = await f.db.permission.findUniqueOrThrow({ where: { code: 'task:read' } });
    expect(await f.db.userRole.count({ where: { userId: f.vendor.user.id, role: { permissions: { some: { permissionId: taskPermission.id } } } } })).toBe(0);
    const token = await app.get(SessionService).create(f.vendor.user.id, f.db, { mfaVerified: true, reauthenticated: true });
    const cookie = `qms_session=${token}`;
    const current = await f.read();
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, { expectedRowVersion: current.rowVersion, selectedFileIds: [] }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { expectedRowVersion: current.rowVersion, selectedFileIds: [], previewToken: preview.previewToken, confirmed: true }).expect(200);
    const inbox = (await f.http(cookie, 'get', `supplier-portal/eight-d/tasks?supplierProblemId=${f.draft.id}`).expect(200)).body;
    expect(inbox.items).toMatchObject([{ kind: 'HANDLING', userId: f.vendor.user.id }]);
    await f.http(f.otherVendor.cookie, 'get', `supplier-portal/eight-d/tasks?supplierProblemId=${f.draft.id}`).expect(200).then(response => expect(response.body.items).toEqual([]));
    await f.http(f.sqe.cookie, 'get', 'supplier-quality/eight-d/tasks').expect(403);
    await f.http(cookie, 'get', 'tasks').expect(403);
    await drainAcceptedEvents();
    const notices = (await f.http(cookie, 'get', `supplier-portal/eight-d/notifications?supplierProblemId=${f.draft.id}`).expect(200)).body;
    expect(notices.items).toMatchObject([{ kind: 'HANDLING_REMINDER', status: 'DELIVERED' }]);
    await f.db.rolePermission.deleteMany({ where: { role: { userRoles: { some: { userId: f.vendor.user.id } } }, permission: { code: 'supplier-quality:responses:read' } } });
    await f.http(cookie, 'get', 'supplier-portal/eight-d/tasks').expect(403);
  }, 30_000);
});
