import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import type { AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { CustomerComplaintLedgerService } from '../../src/modules/customer-quality/customer-complaint-ledger.service.js';
import { CustomerLedgerListDto } from '../../src/modules/customer-quality/customer-complaint-ledger.dto.js';
import { LEDGER_PERMISSIONS } from '../../src/modules/customer-quality/customer-complaint-ledger.types.js';

if (!process.env.DATABASE_URL || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(process.env.DATABASE_URL).port === '55440') {
  throw new Error('An exclusively leased disposable PostgreSQL database is required');
}

describe('PR75 creation responsibility and displayed customer search on PostgreSQL', () => {
  let app: NestExpressApplication, prisma: PrismaService, ledger: CustomerComplaintLedgerService;
  let registrar: AdminActor, engineer: AdminActor, assignmentId: string, cookie: string;
  const organizationId = randomUUID(), csrf = randomUUID(), componentCode = randomUUID();
  const path = '/api/v1/customer-quality/ledger';
  const denied = { status: 403, response: { code: 'CUSTOMER_LEDGER_RESPONSIBILITY_DENIED' } };
  const create = (actor: AdminActor, fields: object, extra = {}) => ledger.create(actor, { fields, ...extra }, randomUUID(), randomUUID());
  const list = (search: string, extra = {}) => ledger.list(registrar, Object.assign(new CustomerLedgerListDto(), { search, ...extra }));

  async function person(permissions: string[]) {
    const user = await prisma.user.create({ data: { organizationId, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), reauthenticatedAt: new Date() } });
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Explicit fixture grants' } });
    for (const code of permissions) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: user.id, organizationId, roleId: role.id } });
    return { id: user.id, organizationId, sessionId: session.id, accountType: 'INTERNAL' as const };
  }

  async function facts() {
    return {
      complaints: await prisma.customerQualityComplaint.count({ where: { organizationId } }),
      events: await prisma.customerQualityComplaintEvent.count({ where: { organizationId } }),
      audits: await prisma.auditEvent.count({ where: { organizationId, outcome: 'SUCCESS' } }),
      receipts: await prisma.adminMutation.count({ where: { organizationId } }),
    };
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttpBodyParser(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService); ledger = app.get(CustomerComplaintLedgerService);
    await prisma.organization.create({ data: { id: organizationId, code: randomUUID(), name: 'PR75 repair', type: 'INTERNAL' } });
    registrar = await person([LEDGER_PERMISSIONS.read, LEDGER_PERMISSIONS.write]);
    engineer = await person([...Object.values(LEDGER_PERMISSIONS), 'component-project:manage']);
    const department = await prisma.department.create({ data: { organizationId, code: randomUUID(), name: 'Quality' } });
    const position = await prisma.position.create({ data: { organizationId, departmentId: department.id, code: randomUUID(), name: 'Not an identity rule' } });
    assignmentId = (await prisma.userPosition.create({ data: { organizationId, userId: engineer.id, positionId: position.id, startedAt: new Date('2026-01-01') } })).id;
    const components = app.get(ComponentProjectService);
    const project = await components.createProject(engineer, organizationId, { code: componentCode, name: 'PR75', stage: 'NEW_PRODUCT', projectEngineerAssignmentId: assignmentId }, randomUUID(), randomUUID());
    await components.createMapping(engineer, organizationId, { componentCode, projectRecordId: project.id, productCategory: 'controller' }, randomUUID(), randomUUID());
    cookie = `qms_session=${await app.get(SessionService).create(registrar.id, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
  });
  afterAll(async () => app?.close());

  it.each(['manual', 'mapped', 'unassigned'])('rejects nonempty investigation by the registrar with %s responsibility without facts or success receipts', async mode => {
    const before = await facts();
    const extra = mode === 'manual' ? { qualityEngineerAssignmentId: assignmentId } : {};
    const fields = { investigation: 'Registrar must not author the QE conclusion', ...(mode === 'mapped' ? { componentCode } : {}) };
    await expect(create(registrar, fields, extra)).rejects.toMatchObject(denied);
    expect(await facts()).toEqual(before);
  });

  it('returns an actual HTTP 403 rather than silently dropping the submitted investigation', async () => {
    const before = await facts();
    const result = await request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
      .send({ fields: { investigation: { original: 'Not just a string' } }, qualityEngineerAssignmentId: assignmentId }).expect(403);
    expect(result.body.code).toBe('HTTP_403');
    expect(await facts()).toEqual(before);
  });

  it('previews and commits the same partial ADD failure and replays the failed receipt without a forged fact or success audit', async () => {
    const input = { mode: 'CONTINUE' as const, rows: [
      { rowNumber: 1, action: 'ADD' as const, qualityEngineerAssignmentId: assignmentId, fields: { investigation: 'Forged imported conclusion' } },
      { rowNumber: 2, action: 'ADD' as const, fields: { customerName: 'Allowed original', investigation: null } },
    ] };
    const before = await facts();
    const preview = await ledger.preview(registrar, input);
    expect(await facts()).toEqual(before);
    const key = randomUUID();
    const result = await ledger.commit(registrar, input, randomUUID(), key);
    expect(result).toMatchObject({ created: 1, failed: 1, items: [
      { rowNumber: 1, outcome: 'FAILED', errorCode: 'CUSTOMER_LEDGER_RESPONSIBILITY_DENIED', complaintId: null, record: null },
      { rowNumber: 2, outcome: 'CREATED', record: { normalized: { quantity: null, investigation: null } } },
    ] });
    expect(preview.items[0]).toMatchObject({ outcome: 'FAILED', errorCode: result.items[0]!.errorCode });
    expect(preview.items[1]!.outcome).toBe('PREVIEW');
    const after = await facts();
    expect(after).toEqual({ complaints: before.complaints + 1, events: before.events, audits: before.audits + 1, receipts: before.receipts + 3 });
    expect(await ledger.commit(registrar, input, randomUUID(), key)).toEqual(result);
    expect(await facts()).toEqual(after);
  });

  it('preserves optional self-QE conclusions and blank/null inputs without quantity or risk defaults', async () => {
    for (const fields of [{ investigation: 'Self-authored original' }, { componentCode, investigation: 'Mapped self' }, { investigation: null }, { investigation: ' \t ' }, {}]) {
      const actor = typeof fields.investigation === 'string' && fields.investigation.trim() ? engineer : registrar;
      const extra = actor === engineer && !fields.componentCode ? { qualityEngineerAssignmentId: assignmentId } : {};
      const row = await create(actor, fields, extra);
      expect(row.raw).toEqual(fields);
      expect(row.normalized.quantity).toBeNull();
      const stored = await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: row.id } });
      expect(stored).toMatchObject({ severity: null, severityPolicyVersion: null, severitySnapshot: null });
    }
    const imported = { mode: 'CONTINUE' as const, rows: [{ rowNumber: 1, action: 'ADD' as const, qualityEngineerAssignmentId: assignmentId, fields: { investigation: 'Self import' } }] };
    expect((await ledger.preview(engineer, imported)).failed).toBe(0);
    expect((await ledger.commit(engineer, imported, randomUUID(), randomUUID())).items[0]!.record!.raw.investigation).toBe('Self import');
    await prisma.userPosition.update({ where: { id: assignmentId }, data: { endedAt: new Date(Date.now() - 1000) } });
    try {
      await expect(create(engineer, { componentCode, investigation: 'Expired self' })).rejects.toMatchObject(denied);
    } finally { await prisma.userPosition.update({ where: { id: assignmentId }, data: { endedAt: null } }); }
  });

  it.each(['missing', 'blank'])('searches displayed associated and legacy customer names with %s raw name before count and pagination', async mode => {
    const name = `PR75-${mode}-${randomUUID()}`;
    const customer = await prisma.customerQualityCustomer.create({ data: { organizationId, code: randomUUID(), name, createdById: registrar.id, updatedById: registrar.id } });
    const fields = mode === 'blank' ? { customerName: ' \t ' } : {};
    const formal = await create(registrar, fields, { customerId: customer.id });
    const legacy = await prisma.customerQualityComplaint.create({ data: { organizationId, complaintNumber: randomUUID(), customerId: customer.id, complaintType: 'ZERO_KM', defectDescription: 'Legacy original', createdById: registrar.id, updatedById: registrar.id } });
    const outside = await prisma.organization.create({ data: { code: randomUUID(), name: 'Decoy organization', type: 'INTERNAL' } });
    const decoy = await prisma.customerQualityCustomer.create({ data: { organizationId: outside.id, code: randomUUID(), name, createdById: registrar.id, updatedById: registrar.id } });
    await prisma.customerQualityComplaint.create({ data: { organizationId: outside.id, complaintNumber: randomUUID(), customerId: decoy.id, createdById: registrar.id, updatedById: registrar.id } });
    await prisma.customerQualityCustomer.update({ where: { id: customer.id }, data: { active: false } });
    expect((await ledger.detail(registrar, formal.id)).normalized.customerName).toBe(name);
    expect((await ledger.detail(registrar, legacy.id)).normalized.customerName).toBe(name);
    const first = await list(name.toLowerCase(), { pageSize: 1 });
    const second = await list(name.toUpperCase(), { pageSize: 1, page: 2 });
    expect(first.total).toBe(2); expect(second.total).toBe(2);
    expect(new Set([...first.items, ...second.items].map(row => row.id))).toEqual(new Set([formal.id, legacy.id]));
    expect((await list(name, { page: 3, pageSize: 1 })).items).toEqual([]);
    expect((await list(name, { complaintType: 'AFTER_SALES' })).total).toBe(0);
    const targets = await request(app.getHttpServer()).get(path).query({ search: name, page: 1, pageSize: 100 }).set('Cookie', cookie).expect(200);
    expect(targets.body.total).toBe(2);
    expect(new Set(targets.body.items.map((row: { id: string }) => row.id))).toEqual(new Set([formal.id, legacy.id]));
  });

  it('keeps raw matches, SQL metacharacters and literal percent, underscore and backslash search semantics', async () => {
    const raw = `Raw-${randomUUID()}`;
    const row = await create(registrar, { customerName: raw });
    expect((await list(raw)).items.map(item => item.id)).toEqual([row.id]);
    const marker = `Master-${randomUUID()}`;
    const name = `${marker}%_\\' OR 1=1 --`;
    const customer = await prisma.customerQualityCustomer.create({ data: { organizationId, code: randomUUID(), name, createdById: registrar.id, updatedById: registrar.id } });
    const associated = await create(registrar, {}, { customerId: customer.id });
    const decoy = await prisma.customerQualityCustomer.create({ data: { organizationId, code: randomUUID(), name: `${marker}XY' OR 1=1 --`, createdById: registrar.id, updatedById: registrar.id } });
    await create(registrar, {}, { customerId: decoy.id });
    expect((await list(name)).items.map(item => item.id)).toEqual([associated.id]);
    expect((await list('%_\\')).items.map(item => item.id)).toEqual([associated.id]);
    expect((await list(`' OR 1=1 --${randomUUID()}`)).total).toBe(0);
  });
});
