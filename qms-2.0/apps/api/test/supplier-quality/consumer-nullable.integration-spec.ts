import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SupplierQualityFileResourceAdapter } from '../../src/modules/supplier-quality/supplier-quality-file-resource.adapter.js';
import { projectSupplierNotification } from '../../src/modules/task-notification/supplier-portal-notification.js';

if (!process.env.DATABASE_URL || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(process.env.DATABASE_URL).port === '55440') {
  throw new Error('Nullable supplier consumers require disposable PostgreSQL');
}

describe('unbound supplier profile consumers on real PostgreSQL and HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let otherCookie: string;
  const ownerId = randomUUID();
  const otherOwnerId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const approverId = randomUUID();
  const roleId = randomUUID();
  const otherRoleId = randomUUID();
  const profileId = randomUUID();
  const supplierId = randomUUID();
  const csrf = randomUUID();
  const permissions = ['supplier-quality:profiles:read', 'supplier-quality:problems:read', 'supplier-quality:problems:write',
    'supplier-quality:responses:write', 'supplier-incoming:inspections:read', 'supplier-incoming:inspections:write',
    'supplier-performance:cards:read', 'supplier-performance:cards:write', 'supplier-performance:cards:publish',
    'supplier-audit:plans:read', 'supplier-audit:plans:write', 'supplier-audit:records:read', 'supplier-audit:records:write',
    'supplier-quality:targets:read', 'supplier-quality:targets:write', 'supplier-quality:targets:approve', 'supplier-quality:targets:publish',
    'supplier-meetings:read', 'supplier-meetings:write', 'supplier-meetings:conclude',
    'supplier-ppap:read', 'supplier-ppap:write', 'supplier-inspection-standards:read', 'supplier-inspection-standards:write', 'supplier-inspection-standards:publish',
    'supplier-barcode:read', 'supplier-barcode:write', 'supplier-barcode:publish', 'supplier-asn:read', 'supplier-asn:write',
    'supplier-concession:requests:read', 'supplier-concession:requests:write', 'supplier-concession:requests:approve', 'supplier-concession:requests:release'];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    for (const id of [ownerId, otherOwnerId]) await prisma.organization.create({ data: { id, code: `NULL-${id}`, name: 'Nullable consumer owner', type: 'INTERNAL' } });
    await prisma.organization.create({ data: { id: supplierId, code: `NULL-${supplierId}`, name: 'Later collaboration', type: 'SUPPLIER' } });
    for (const [id, organizationId, assignedRole] of [[userId, ownerId, roleId], [otherUserId, otherOwnerId, otherRoleId]]) {
      await prisma.user.create({ data: { id, organizationId, username: `null-${id}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
      await prisma.role.create({ data: { id: assignedRole, organizationId, code: 'NULL_CONSUMER', name: 'Nullable consumers' } });
      for (const code of permissions) {
        const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
        await prisma.rolePermission.create({ data: { roleId: assignedRole, permissionId: permission.id } });
      }
      await prisma.userRole.create({ data: { userId: id, organizationId, roleId: assignedRole } });
    }
    cookie = `qms_session=${await app.get(SessionService).create(userId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    otherCookie = `qms_session=${await app.get(SessionService).create(otherUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    await prisma.user.create({ data: { id: approverId, organizationId: ownerId, username: `null-${approverId}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.userRole.create({ data: { userId: approverId, organizationId: ownerId, roleId } });
    await prisma.$executeRaw`INSERT INTO supplier_business_profiles (id, owner_organization_id, business_code, display_name, updated_at) VALUES (${profileId}::uuid, ${ownerId}::uuid, 'NULL-01', 'Unbound supplier', CURRENT_TIMESTAMP)`;
  }, 30_000);

  afterAll(async () => { await app?.close(); });

  function post(path: string, body: object, session = cookie) {
    return request(app.getHttpServer()).post(`/api/v1/${path}`).set('Cookie', session).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body);
  }
  function put(path: string, body: object, session = cookie) {
    return request(app.getHttpServer()).put(`/api/v1/${path}`).set('Cookie', session).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body);
  }

  const creations = [
    ['supplier-meetings', { title: 'Internal meeting', scheduledStart: '2026-11-01T09:00:00Z', scheduledEnd: '2026-11-01T10:00:00Z' }],
    ['supplier-ppap', { title: 'Internal PPAP', partNumber: 'MAT-NULL', level: 1 }],
    ['supplier-inspection-standards', { title: 'Internal standard', materialCode: 'MAT-NULL' }],
    ['supplier-barcode', { title: 'Internal barcode', materialCode: 'MAT-NULL', prefix: 'N-', codeLength: 10 }],
    ['supplier-asn', { asnNumber: 'NULL-ASN', materialCode: 'MAT-NULL', plannedArrivalDate: '2026-11-01', quantity: 10 }],
  ] as const;

  it.each(creations)('creates %s internally with a genuine null snapshot and owner isolation', async (path, input) => {
    const created = await post(path, { profileId, ...input }).expect(201);
    expect(created.body.supplierOrganizationId).toBeNull();
    const page = await request(app.getHttpServer()).get(`/api/v1/${path}`).set('Cookie', cookie).expect(200);
    expect(page.body.items.find((item: { id: string }) => item.id === created.body.id).supplierOrganizationId).toBeNull();
    await post(path, { profileId, ...input }, otherCookie).expect(404);
  });

  it('creates an audit record from an unbound submitted plan', async () => {
    const plan = await post('supplier-audit/plans', { profileId, auditYear: 2026, auditType: 'ANNUAL', title: 'Internal audit', plannedStart: '2026-11-01T09:00:00Z', plannedEnd: '2026-11-01T10:00:00Z' }).expect(201);
    expect(plan.body.supplierOrganizationId).toBeNull();
    await put(`supplier-audit/plans/${plan.body.id}/submit`, { expectedVersion: 1 }).expect(200);
    const record = await post('supplier-audit/records', { planId: plan.body.id, auditDate: '2026-11-01', auditor: 'Internal auditor', summary: 'Internal evidence review' }).expect(201);
    expect(record.body.supplierOrganizationId).toBeNull();
  });

  it('publishes and revises internal quality targets without enabling collaboration', async () => {
    const input = { profileId, periodType: 'ANNUAL', targetYear: 2026, title: 'Internal target', metrics: { ppm: 100 } };
    const target = await post('supplier-quality-targets', input).expect(201);
    expect(target.body.supplierOrganizationId).toBeNull();
    await post(`supplier-quality-targets/${target.body.id}/submit`, { expectedVersion: 1 }).expect(201);
    await post(`supplier-quality-targets/${target.body.id}/approve`, { expectedVersion: 2 }).expect(201);
    await post(`supplier-quality-targets/${target.body.id}/publish`, { expectedVersion: 3, effectiveFrom: '2026-01-01' }).expect(201);
    const revised = await post(`supplier-quality-targets/${target.body.id}/revise`, { ...input, expectedVersion: 4 }).expect(201);
    expect(revised.body.supplierOrganizationId).toBeNull();
  });

  it('links an unbound NG inspection to an internal problem and creates a concession', async () => {
    const inspection = await post('supplier-incoming/inspections', { profileId, materialCode: 'MAT-NULL', incomingBatch: randomUUID(), receivedQuantity: 10, sampledQuantity: 2, sourceSystem: 'MANUAL', items: [{ order: 1, name: 'Dimension', result: 'PASS' }] }).expect(201);
    expect(inspection.body.supplierOrganizationId).toBeNull();
    await put(`supplier-incoming/inspections/${inspection.body.id}/complete`, { expectedVersion: 1, conclusion: 'NG' }).expect(200);
    await post(`supplier-incoming/inspections/${inspection.body.id}/problem-links`, { expectedVersion: 2, title: 'Internal NG', defectDescription: 'Measured deviation', defectQuantity: 1, severity: 'LOW', responseForm: 'BRIEF', replyMode: 'INTERNAL', internalResponderId: userId }).expect(201);
    const concession = await post('supplier-concessions', { inspectionId: inspection.body.id, quantity: 1, reason: 'Internal disposition', expiresAt: '2027-01-01T00:00:00Z' }).expect(201);
    const rows = await prisma.$queryRaw<{ supplier_organization_id: string | null }[]>`SELECT supplier_organization_id FROM supplier_concession_requests WHERE id = ${concession.body.id}::uuid`;
    expect(rows[0]!.supplier_organization_id).toBeNull();
    await post(`supplier-concessions/${concession.body.id}/submit`, { expectedVersion: 1 }).expect(201);
    const approverCookie = `qms_session=${await app.get(SessionService).create(approverId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    await post(`supplier-concessions/${concession.body.id}/approve`, { expectedVersion: 2, note: 'Approved internal use' }, approverCookie).expect(201);
    const released = await post(`supplier-concessions/${concession.body.id}/release`, { expectedVersion: 3, note: 'Internal release' }).expect(201);
    expect(released.body.status).toBe('RELEASED');
  });

  it('uses the owner for unbound internal files, denies outsiders and rejects a released-null notification invariant', async () => {
    const record = await prisma.supplierQualityProblem.create({ data: { ownerOrganizationId: ownerId, profileId, title: 'Nullable notification invariant', materialCode: 'MAT-NULL', defectDescription: 'Internal evidence', defectQuantity: 1, severity: 'LOW', responseForm: 'BRIEF', replyMode: 'SUPPLIER', createdById: userId } });
    const index = await prisma.problemIndex.create({ data: { organizationId: ownerId, reportNumber: randomUUID(), domainCode: 'supplier-quality', sourceType: 'supplier-quality', sourceId: record.id, problemType: 'BRIEF', severity: 'LOW' } });
    await prisma.supplierQualityProblem.update({ where: { id: record.id }, data: { problemIndexId: index.id } });
    const definition = await prisma.workflowDefinition.create({ data: { organizationId: ownerId, code: randomUUID(), name: 'Notification guard fixture', createdById: userId, updatedById: userId } });
    const version = await prisma.workflowVersion.create({ data: { organizationId: ownerId, workflowDefinitionId: definition.id, version: 1, status: 'PUBLISHED', publishedAt: new Date(), publishedById: userId, structureSnapshot: {} } });
    const node = await prisma.workflowNode.create({ data: { organizationId: ownerId, workflowVersionId: version.id, nodeKey: 'reply', type: 'ACTION', name: 'Supplier reply', config: { assignment: { permission: 'supplier-quality:responses:write' } } } });
    const instance = await prisma.workflowInstance.create({ data: { organizationId: ownerId, problemIndexId: index.id, workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: randomUUID(), currentNodeId: node.id } });
    const task = await prisma.workflowTask.create({ data: { organizationId: ownerId, workflowInstanceId: instance.id, workflowNodeId: node.id, workflowVersionId: version.id, entryInstanceVersion: 1 } });
    const session = await prisma.session.findFirstOrThrow({ where: { userId } });
    const adapter = app.get(SupplierQualityFileResourceAdapter);
    const resource = { resourceType: 'supplier-quality', resourceId: record.id };
    const actor = { id: userId, organizationId: ownerId, accountType: 'INTERNAL' as const, sessionId: session.id };
    expect(await prisma.$transaction((tx) => adapter.authorizeAndLock(tx, actor, resource, 'read'))).toMatchObject({ organizationId: ownerId });
    await expect(prisma.$transaction((tx) => adapter.authorizeAndLock(tx, { ...actor, id: otherUserId, organizationId: otherOwnerId }, resource, 'read'))).rejects.toThrow();
    await expect(prisma.$transaction((tx) => adapter.authorizeAndLock(tx, { ...actor, accountType: 'SUPPLIER', organizationId: supplierId }, resource, 'read'))).rejects.toThrow();
    expect(await prisma.$transaction((tx) => projectSupplierNotification(tx, index, node, task, randomUUID(), 'TASK_ASSIGNED', new Date()))).toBe(true);
    await expect(prisma.supplierQualityProblem.update({ where: { id: record.id }, data: { releasedToSupplierAt: new Date() } })).rejects.toThrow('supplier_quality_problems_collaboration_check');
    // The real CHECK forbids this state; separately exercise the projection's defensive guard.
    const invalidProjection = { supplierQualityProblem: { findFirst: async () => ({ ...record, supplierOrganizationId: null, releasedToSupplierAt: new Date() }) } } as unknown as Prisma.TransactionClient;
    await expect(projectSupplierNotification(invalidProjection, index, node, task, randomUUID(), 'TASK_ASSIGNED', new Date())).rejects.toThrow('SUPPLIER_NOTIFICATION_ORGANIZATION_INVALID');
    expect(await prisma.supplierPortalNotification.count({ where: { supplierProblemId: record.id } })).toBe(0);
  });

  it('rejects external performance publication while unbound and lazily fills only the draft after binding', async () => {
    const inspection = await post('supplier-incoming/inspections', { profileId, materialCode: 'PERF-NULL', incomingBatch: randomUUID(), receivedQuantity: 10, sampledQuantity: 2, sourceSystem: 'MANUAL', items: [{ order: 1, name: 'Dimension', result: 'PASS' }] }).expect(201);
    await put(`supplier-incoming/inspections/${inspection.body.id}/complete`, { expectedVersion: 1, conclusion: 'PASS' }).expect(200);
    const month = new Date().toISOString().slice(0, 7);
    const card = await post('supplier-performance/cards', { profileId, month, cooperationScore: 100, cooperationNote: 'Internal score', incomingWeight: 60, cooperationWeight: 40 }).expect(201);
    expect(card.body.supplierOrganizationId).toBeNull();
    const endpoint = `supplier-performance/cards/${card.body.id}/publish`;
    const blocked = await put(endpoint, { expectedVersion: 1 }).expect(409);
    expect(blocked.body.code).toBe('SUPPLIER_COLLABORATION_NOT_ENABLED');
    expect(await prisma.supplierPortalNotification.count({ where: { ownerOrganizationId: ownerId } })).toBe(0);
    await prisma.supplierBusinessProfile.update({ where: { id: profileId }, data: { supplierOrganizationId: supplierId } });
    const published = await put(endpoint, { expectedVersion: 1 }).expect(200);
    expect(published.body).toMatchObject({ supplierOrganizationId: supplierId, status: 'PUBLISHED', version: 2 });
    await put(endpoint, { expectedVersion: 1 }).expect(409);
    const snapshots = await prisma.$queryRaw<{ supplier_organization_id: string | null }[]>`SELECT supplier_organization_id FROM supplier_incoming_inspections WHERE id = ${inspection.body.id}::uuid`;
    expect(snapshots[0]!.supplier_organization_id).toBeNull();
  });
});
