import 'reflect-metadata';
import { jest } from '@jest/globals';
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { HttpException, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Component import tests require disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(120_000);

describe('component catalog import with real PostgreSQL / HTTP', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const csrf = randomUUID();
  const base = '/api/v1/admin/configuration/component-project-mappings';
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttpBodyParser(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app?.close(); });

  async function fixture(codes = ['component-project:read', 'component-project:manage'], type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'N2 import fixture', type } });
    const user = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: type } });
    const permissions = await Promise.all(codes.map((code) => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Import fixture role', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: role.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = (await app.get(SessionService).resolve(token))!;
    return { org, user, role, cookie: `qms_session=${token}; qms_csrf=${csrf}`, actor: { ...session.user, sessionId: session.id } };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const row = (rowNumber = 1, componentCode: unknown = 'ZA.M030-R0000', componentName: unknown = 'Sample ^^ assembly, (left)') => ({ rowNumber, componentCode, componentName });
  function post(f: Fixture, body: object, key = randomUUID()) {
    return request(app.getHttpServer()).post(`${base}/import`).set('Cookie', f.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }
  function list(f: Fixture, query: object = {}) {
    return request(app.getHttpServer()).get(base).set('Cookie', f.cookie).query({ organizationId: f.org.id, ...query });
  }
  function resolve(f: Fixture, componentCode: string, query: object = {}) {
    return request(app.getHttpServer()).get(`${base}/resolve`).set('Cookie', f.cookie).query({ componentCode, ...query });
  }
  function patch(f: Fixture, id: string, body: object) {
    return request(app.getHttpServer()).patch(`${base}/${id}`).set('Cookie', f.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body);
  }
  async function project(f: Fixture) {
    return (await request(app.getHttpServer()).post('/api/v1/admin/configuration/component-project-records')
      .set('Cookie', f.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
      .send({ code: randomUUID(), name: 'Shared project', stage: 'NEW_PRODUCT' }).expect(201)).body;
  }
  async function grantScope(f: Fixture, target: Fixture) {
    const permissions = await prisma.permission.findMany({ where: { code: { in: ['component-project:read', 'component-project:manage'] } } });
    const role = await prisma.role.create({ data: { organizationId: target.org.id, code: randomUUID(), name: 'Cross scope', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { organizationId: target.org.id, userId: f.user.id, roleId: role.id } });
    return role;
  }

  function gate() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    return { promise, release };
  }

  it('adds a nullable catalog name and nullable project/category while retaining scoped RESTRICT foreign keys', async () => {
    const columns = await prisma.$queryRaw<{ name: string; nullable: string; length: number | null }[]>`SELECT column_name AS name, is_nullable AS nullable, character_maximum_length AS length FROM information_schema.columns WHERE table_name = 'component_project_mappings' AND column_name IN ('component_name', 'project_record_id', 'product_category') ORDER BY column_name`;
    expect(columns).toEqual([
      { name: 'component_name', nullable: 'YES', length: 200 },
      { name: 'product_category', nullable: 'YES', length: 100 },
      { name: 'project_record_id', nullable: 'YES', length: null },
    ]);
    const foreign = await prisma.$queryRaw<{ deletion: string; update: string; definition: string }[]>`SELECT confdeltype::text AS deletion, confupdtype::text AS update, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = to_regclass('component_project_mappings') AND contype = 'f'`;
    expect(foreign.every((fk) => fk.deletion === 'r' && fk.update === 'r')).toBe(true);
    expect(foreign.some((fk) => fk.definition.includes('FOREIGN KEY (organization_id, project_record_id)'))).toBe(true);
  });

  it('imports basic text only, preserves IMS punctuation/leading zeros, lists unmapped rows and audits nullable facts', async () => {
    const f = await fixture();
    const result = (await post(f, { rows: [row(1, '  ZA.M030-R0000  ', '  Sample ^^ assembly, (left)  '), row(2, '00012-A.0', 'Other')] }).expect(201)).body;
    expect(result).toEqual({ items: [{ rowNumber: 1, code: 'ZA.M030-R0000', status: 'CREATED' }, { rowNumber: 2, code: '00012-A.0', status: 'CREATED' }], created: 2, skipped: 0, failed: 0 });
    const page = (await list(f, { search: '^^ assembly' }).expect(200)).body;
    expect(page).toMatchObject({ total: 1, page: 1 });
    expect(page.items).toHaveLength(1);
    const mapping = page.items[0];
    expect(mapping).toMatchObject({ componentCode: 'ZA.M030-R0000', componentName: 'Sample ^^ assembly, (left)', projectRecordId: null, productCategory: null, productSubcategory: null, project: null, status: 'ACTIVE', version: 1 });
    expect((await list(f, { pageSize: 1, page: 2 }).expect(200)).body).toMatchObject({ total: 2, items: [expect.objectContaining({ project: null })] });
    expect((await resolve(f, mapping.componentCode).expect(200)).body).toMatchObject({ outcome: 'unmapped', mapping: { id: mapping.id, componentName: mapping.componentName }, project: null, effectiveQualityEngineerId: null, issues: ['PROJECT_NOT_CONFIGURED', 'PRODUCT_CATEGORY_NOT_CONFIGURED'] });
    expect(await prisma.$queryRaw`SELECT id FROM component_project_records WHERE organization_id = ${f.org.id}::uuid`).toEqual([]);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: mapping.id, action: 'COMPONENT_PROJECT_MAPPING_CREATED' } });
    expect(audit.metadata).toMatchObject({ componentName: mapping.componentName, componentCode: mapping.componentCode, projectRecordId: null, productCategory: null, resourceVersion: 1 });
  });

  it('continues past invalid contents, uses Unicode codepoint limits and stores stable invalid/duplicate receipts', async () => {
    const f = await fixture();
    const key = randomUUID();
    const rows = [row(4, 'ZA.M030-R0000', 'Different'), row(1), row(2, 123), row(3, { formula: 'A1' }), row(5, 'Bad-name', 123), row(6, ' ', 'Name'), { rowNumber: 7, componentCode: 'Missing' }, row(8, '\u{20000}'.repeat(100), '\u{20000}'.repeat(200)), row(9, '\u{20000}'.repeat(101)), row(10, 'Long-name', '\u{20000}'.repeat(201)), row(11, 'Blank-name', '  '), row(12, 'Last', 'Last')];
    const result = (await post(f, { rows }, key).expect(201)).body;
    expect(result).toMatchObject({ created: 3, skipped: 1, failed: 8 });
    expect(result.items[0]).toEqual({ rowNumber: 1, code: 'ZA.M030-R0000', status: 'CREATED' });
    expect(result.items[3]).toEqual({ rowNumber: 4, code: 'ZA.M030-R0000', status: 'SKIPPED_DUPLICATE' });
    for (const item of result.items.filter((item: { status: string }) => item.status === 'FAILED')) expect(item.errorCode).toBe('COMPONENT_PROJECT_IMPORT_ROW_INVALID');
    expect((await post(f, { rows }, key).expect(201)).body).toEqual(result);
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id, action: 'COMPONENT_PROJECT_IMPORT_ROW' } })).toBe(rows.length);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, action: 'COMPONENT_PROJECT_MAPPING_CREATED' } })).toBe(3);
    const wide = (await list(f, { search: '\u{20000}' }).expect(200)).body.items[0];
    expect(wide.componentName).toBe('\u{20000}'.repeat(200));
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: wide.id } })).metadata).toMatchObject({ componentName: wide.componentName });
  });

  it('rejects malformed batches, repeated row numbers and unknown fields before any batch receipt', async () => {
    const f = await fixture();
    for (const body of [{ rows: [] }, { rows: Array.from({ length: 101 }, (_, i) => row(i + 1, `C${i}`)) }, { rows: [row(), row()] }, { rows: [row(0)] }, { rows: [row(1.5)] }, { rows: [{ ...row(), rowNumber: '1' }] }, { rows: [null] }, { rows: [[row()]] }, { rows: [{ ...row(), productCategory: 'Inferred' }] }, { rows: [row()], PROD_ID: 'Alias' }, { rows: 'bad' }]) {
      await post(f, body).expect(400);
    }
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id } })).toBe(0);
    await expect(app.get(ComponentProjectService).importComponents(f.actor, f.org.id, { rows: [row(), row()] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
  });

  it('fails unrepresentable PostgreSQL text per row rather than aborting or silently replacing code/name characters', async () => {
    const f = await fixture();
    const rows = [row(1, 'A\u0000B'), row(2, 'Bad-name', 'A\u0000B'), row(3, 'A\uD800B'), row(4, 'Lone-name', 'A\uDC00B'), row(5, 'Valid-\u{20000}')];
    const result = (await post(f, { rows }).expect(201)).body;
    expect(result).toMatchObject({ created: 1, skipped: 0, failed: 4 });
    expect(result.items.slice(0, 4)).toEqual([
      { rowNumber: 1, code: '', status: 'FAILED', errorCode: 'COMPONENT_PROJECT_IMPORT_ROW_INVALID' },
      { rowNumber: 2, code: 'Bad-name', status: 'FAILED', errorCode: 'COMPONENT_PROJECT_IMPORT_ROW_INVALID' },
      { rowNumber: 3, code: '', status: 'FAILED', errorCode: 'COMPONENT_PROJECT_IMPORT_ROW_INVALID' },
      { rowNumber: 4, code: 'Lone-name', status: 'FAILED', errorCode: 'COMPONENT_PROJECT_IMPORT_ROW_INVALID' },
    ]);
    expect((await list(f).expect(200)).body.total).toBe(1);
  });

  it('accepts exactly 100 rows and rejects empty non-null catalog/category values at the database boundary', async () => {
    const f = await fixture();
    const rows = Array.from({ length: 100 }, (_, i) => row(i + 1, `000${i}-A.0`));
    expect((await post(f, { rows }).expect(201)).body).toMatchObject({ created: 100, skipped: 0, failed: 0 });
    for (const value of ['', '  ']) {
      await expect(prisma.$executeRaw`UPDATE component_project_mappings SET component_name = ${value} WHERE organization_id = ${f.org.id}::uuid`).rejects.toMatchObject({ code: 'P2010' });
      await expect(prisma.$executeRaw`UPDATE component_project_mappings SET product_category = ${value} WHERE organization_id = ${f.org.id}::uuid`).rejects.toMatchObject({ code: 'P2010' });
    }
    expect((await list(f, { pageSize: 100 }).expect(200)).body.items).toHaveLength(100);
  });

  it('accepts 100 Unicode codepoint-limit rows through the production HTTP parser', async () => {
    const f = await fixture();
    const rows = Array.from({ length: 100 }, (_, index) => row(index + 1,
      '\u{20000}'.repeat(97) + String(index).padStart(3, '0'), '\u{20000}'.repeat(200)));
    expect(Buffer.byteLength(JSON.stringify({ rows }), 'utf8')).toBeGreaterThan(100 * 1024);
    expect((await post(f, { rows }).expect(201)).body).toMatchObject({ created: 100, skipped: 0, failed: 0 });
    expect((await list(f, { pageSize: 100 }).expect(200)).body.items).toHaveLength(100);
  });

  it('never overwrites existing names, mappings, classifications, shared engineers or disabled status', async () => {
    const f = await fixture();
    const p = await project(f);
    const department = await prisma.department.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Engineering' } });
    const position = await prisma.position.create({ data: { organizationId: f.org.id, departmentId: department.id, code: randomUUID(), name: 'Engineer' } });
    const appointment = await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.user.id, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
    p.customerEngineerAssignmentId = appointment.id;
    p.projectEngineerAssignmentId = appointment.id;
    await prisma.$executeRaw`UPDATE component_project_records SET customer_engineer_assignment_id = ${appointment.id}::uuid, project_engineer_assignment_id = ${appointment.id}::uuid WHERE id = ${p.id}::uuid`;
    const created = (await request(app.getHttpServer()).post(base).set('Cookie', f.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
      .send({ componentCode: 'Existing', componentName: 'Original', projectRecordId: p.id, productCategory: 'Exact', productSubcategory: 'Detail', status: 'DISABLED' }).expect(201)).body;
    const result = (await post(f, { rows: [row(1, 'Existing', 'Replacement'), row(2, 'Existing', 'Again')] }).expect(201)).body;
    expect(result).toMatchObject({ created: 0, skipped: 2, failed: 0 });
    const engineer = expect.objectContaining({ assignmentId: appointment.id, userId: f.user.id, positionId: position.id, departmentId: department.id, valid: true, issues: [] });
    expect((await list(f).expect(200)).body.items[0]).toEqual({ ...created, project: { id: p.id, code: p.code, name: p.name, stage: p.stage, status: p.status, customerEngineer: engineer, projectEngineer: engineer } });
    expect((await resolve(f, 'Existing').expect(200)).body.project).toEqual(p);
    expect(await prisma.auditEvent.count({ where: { resourceId: created.id, action: 'COMPONENT_PROJECT_MAPPING_CREATED' } })).toBe(1);
  });

  it('updates name/status without a project, clears nullable names, then resolves immediately after completion', async () => {
    const f = await fixture();
    await post(f, { rows: [row()] }).expect(201);
    const m = (await list(f).expect(200)).body.items[0];
    await patch(f, m.id, { expectedVersion: 1, componentName: null, status: 'DISABLED' }).expect(200);
    expect((await resolve(f, m.componentCode).expect(200)).body).toMatchObject({ outcome: 'inactive', mapping: { componentName: null }, project: null });
    await patch(f, m.id, { expectedVersion: 2, componentName: '  Renamed ^^, (A)  ', status: 'ACTIVE' }).expect(200);
    const p = await project(f);
    await patch(f, m.id, { expectedVersion: 3, projectRecordId: p.id }).expect(200);
    expect((await resolve(f, m.componentCode).expect(200)).body).toMatchObject({ outcome: 'unmapped', project: { id: p.id, stage: 'NEW_PRODUCT' }, issues: ['PRODUCT_CATEGORY_NOT_CONFIGURED'] });
    await patch(f, m.id, { expectedVersion: 4, productCategory: 'Specified' }).expect(200);
    const manualId = randomUUID();
    expect((await resolve(f, m.componentCode, { currentQualityEngineerId: manualId, currentQualityEngineerSource: 'MANUAL' }).expect(200)).body).toMatchObject({ outcome: 'matched', mapping: { componentName: 'Renamed ^^, (A)', productCategory: 'Specified' }, project: { id: p.id }, effectiveQualityEngineerId: manualId });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: m.id, action: 'COMPONENT_PROJECT_MAPPING_UPDATED', metadata: { path: ['resourceVersion'], equals: 2 } } });
    expect(audit.metadata).toMatchObject({ componentName: null, previousComponentName: row().componentName, projectRecordId: null, previousProjectRecordId: null, productCategory: null, previousProductCategory: null });
    for (const componentName of ['', ' ', 123, '\u{20000}'.repeat(201)]) await patch(f, m.id, { expectedVersion: 5, componentName }).expect(400);
    await patch(f, m.id, { expectedVersion: 5, componentName: '\u{20000}'.repeat(200) }).expect(200);
  });

  it('reserves the original payload, refuses changed/appended rows and requires session, CSRF and idempotency', async () => {
    const f = await fixture();
    const key = randomUUID();
    const body = { rows: [row()] };
    const original = (await post(f, body, key).expect(201)).body;
    expect((await post(f, body, key).expect(201)).body).toEqual(original);
    for (const rows of [[row(1, 'Changed')], [row(), row(2, 'Append')]]) expect((await post(f, { rows }, key).expect(409)).body.code).toBe('IDEMPOTENCY_REPLAY');
    await request(app.getHttpServer()).post(`${base}/import`).set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send(body).expect(401);
    await request(app.getHttpServer()).post(`${base}/import`).set('Cookie', f.cookie).send(body).expect(403);
    await request(app.getHttpServer()).post(`${base}/import`).set('Cookie', f.cookie).set('x-csrf-token', csrf).send(body).expect(400);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, action: 'COMPONENT_PROJECT_MAPPING_CREATED' } })).toBe(1);
  });

  it('uses body scope, allows manage-only imports, and denies foreign, supplier, disabled and revoked scopes on replay', async () => {
    const manager = await fixture(['component-project:manage']);
    await post(manager, { rows: [row()] }).expect(201);
    const read = await fixture(['component-project:read']);
    await post(read, { rows: [row()] }).expect(403);
    const config = await fixture(['configuration:manage', 'material-master:import']);
    await post(config, { rows: [row()] }).expect(403);
    const f = await fixture();
    const other = await fixture();
    const supplier = await fixture(undefined, 'SUPPLIER');
    await post(supplier, { rows: [row()] }).expect(403);
    await post(f, { organizationId: other.org.id, rows: [row()] }).expect(403);
    const role = await grantScope(f, other);
    const key = randomUUID();
    const body = { organizationId: other.org.id, rows: [row()] };
    await post(f, body, key).expect(201);
    expect((await list(f).expect(200)).body.total).toBe(0);
    expect((await list(other).expect(200)).body.total).toBe(1);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await post(f, body, key).expect(403);
    await grantScope(f, other);
    await prisma.organization.update({ where: { id: other.org.id }, data: { status: 'DISABLED' } });
    await post(f, body, key).expect(403);
    const actor = await fixture();
    const actorKey = randomUUID();
    await post(actor, { rows: [row()] }, actorKey).expect(201);
    await prisma.user.update({ where: { id: actor.user.id }, data: { status: 'DISABLED' } });
    await expect(app.get(ComponentProjectService).importComponents(actor.actor, actor.org.id, { rows: [row()] }, randomUUID(), actorKey)).rejects.toMatchObject({ status: 401 });
  });

  it('recovers committed unknown results without duplicate writes/audits and does not hide database failures', async () => {
    const f = await fixture();
    const mutations = app.get(AdminMutationService);
    const run = mutations.run.bind(mutations);
    let lost = false;
    jest.spyOn(mutations, 'run').mockImplementation(async (...args: Parameters<typeof mutations.run>) => {
      const result = await run(...args);
      if (args[0].action === 'COMPONENT_PROJECT_IMPORT_ROW' && !lost) { lost = true; throw new Error('unknown result'); }
      return result;
    });
    const key = randomUUID();
    const body = { rows: [row(), row(2, 'Second')] };
    const service = app.get(ComponentProjectService);
    await expect(service.importComponents(f.actor, f.org.id, body, randomUUID(), key)).rejects.toThrow('unknown result');
    const result = await service.importComponents(f.actor, f.org.id, body, randomUUID(), key);
    expect(result).toMatchObject({ created: 2, skipped: 0, failed: 0 });
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, action: 'COMPONENT_PROJECT_MAPPING_CREATED' } })).toBe(2);
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id, action: 'COMPONENT_PROJECT_IMPORT_ROW' } })).toBe(2);
  });

  it('aborts on a row receipt conflict instead of treating it as an ordinary row failure', async () => {
    const f = await fixture();
    const key = randomUUID();
    const rowKey = `component-import:${createHash('sha256').update(key).digest('hex')}:1`;
    await app.get(AdminMutationService).run({ actor: f.actor, organizationId: f.org.id, key: rowKey, traceId: randomUUID(), action: 'COMPONENT_PROJECT_IMPORT_ROW', payload: row(1, 'Different'), permission: 'component-project:manage' }, async () => null);
    const response = await post(f, { rows: [row(), row(2, 'Second')] }, key).expect(409);
    expect(response.body.code).toBe('IDEMPOTENCY_REPLAY');
    expect((await list(f).expect(200)).body.total).toBe(0);
  });

  it('returns a masked HTTP failure for unknown database/audit exceptions, never SQL or a false row success', async () => {
    const f = await fixture();
    const audit = app.get(AuditLogService);
    const record = audit.record.bind(audit);
    jest.spyOn(audit, 'record').mockImplementation(async (...args: Parameters<typeof audit.record>) => {
      if (args[0].action === 'COMPONENT_PROJECT_MAPPING_CREATED') throw new Error('SELECT secret FROM internal_table');
      return record(...args);
    });
    const response = await post(f, { rows: [row()] }).expect(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toMatch(/SELECT|secret|internal_table/);
    expect((await list(f).expect(200)).body.total).toBe(0);
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id, action: 'COMPONENT_PROJECT_IMPORT_ROW' } })).toBe(0);
  });

  it('rolls back a row and its receipt on audit failure but retains earlier rows for retry', async () => {
    const f = await fixture();
    const audit = app.get(AuditLogService);
    const record = audit.record.bind(audit);
    let successes = 0;
    const spy = jest.spyOn(audit, 'record').mockImplementation(async (...args: Parameters<typeof audit.record>) => {
      if (args[0].action === 'COMPONENT_PROJECT_MAPPING_CREATED' && ++successes === 2) throw new Error('audit unavailable');
      return record(...args);
    });
    const key = randomUUID();
    const body = { rows: [row(), row(2, 'Second'), row(3, 'Third')] };
    const service = app.get(ComponentProjectService);
    await expect(service.importComponents(f.actor, f.org.id, body, randomUUID(), key)).rejects.toThrow('audit unavailable');
    expect((await list(f).expect(200)).body.total).toBe(1);
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id, action: 'COMPONENT_PROJECT_IMPORT_ROW' } })).toBe(1);
    spy.mockRestore();
    expect(await service.importComponents(f.actor, f.org.id, body, randomUUID(), key)).toMatchObject({ created: 3, failed: 0 });
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, action: 'COMPONENT_PROJECT_MAPPING_CREATED' } })).toBe(3);
  });

  it.each(['permission', 'session', 'organization', 'internal type'] as const)('revalidates %s between rows and aborts rather than returning a row failure', async (change) => {
    const f = await fixture();
    const target = await fixture();
    const role = await grantScope(f, target);
    const mutations = app.get(AdminMutationService);
    const run = mutations.run.bind(mutations);
    let changed = false;
    jest.spyOn(mutations, 'run').mockImplementation(async (...args: Parameters<typeof mutations.run>) => {
      const result = await run(...args);
      if (args[0].action === 'COMPONENT_PROJECT_IMPORT_ROW' && !changed) {
        changed = true;
        if (change === 'permission') await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
        if (change === 'session') await prisma.session.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
        if (change === 'organization') await prisma.organization.update({ where: { id: target.org.id }, data: { status: 'DISABLED' } });
        if (change === 'internal type') await prisma.organization.update({ where: { id: target.org.id }, data: { type: 'SUPPLIER' } });
      }
      return result;
    });
    await expect(app.get(ComponentProjectService).importComponents(f.actor, target.org.id, { rows: [row(), row(2, 'Second')] }, randomUUID(), randomUUID())).rejects.toBeInstanceOf(HttpException);
    expect(await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int FROM component_project_mappings WHERE organization_id = ${target.org.id}::uuid`).toEqual([{ count: 1 }]);
    expect(await prisma.adminMutation.count({ where: { organizationId: target.org.id, action: 'COMPONENT_PROJECT_IMPORT_ROW' } })).toBe(1);
  });

  it('serializes each cross-scope row against target organization disable, not merely the actor home organization', async () => {
    const f = await fixture();
    const target = await fixture();
    await grantScope(f, target);
    const reserved = gate();
    const startRows = gate();
    const locked = gate();
    const disable = gate();
    const mutations = app.get(AdminMutationService);
    const run = mutations.run.bind(mutations);
    jest.spyOn(mutations, 'run').mockImplementation(async (...args: Parameters<typeof mutations.run>) => {
      const result = await run(...args);
      if (args[0].action === 'COMPONENT_PROJECT_IMPORT') { reserved.release(); await startRows.promise; }
      return result;
    });
    const service = app.get(ComponentProjectService);
    const key = randomUUID();
    const body = { rows: [row()] };
    const importing = service.importComponents(f.actor, target.org.id, body, randomUUID(), key).then((result) => ({ result, error: null }), (error: unknown) => ({ result: null, error }));
    await reserved.promise;
    let blocker = 0;
    const disabling = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${target.org.id}::uuid FOR UPDATE`;
      const [pid] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      blocker = pid!.pid;
      locked.release();
      await disable.promise;
      await tx.organization.update({ where: { id: target.org.id }, data: { status: 'DISABLED' } });
    }, { timeout: 15_000 });
    await locked.promise;
    startRows.release();
    let waiting = false;
    try {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !waiting) {
        const [state] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${blocker}::int = ANY(pg_blocking_pids(pid)) AND query LIKE '%FOR SHARE%') AS waiting`;
        waiting = state!.waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally { disable.release(); }
    await disabling;
    const outcome = await importing;
    expect(waiting).toBe(true);
    expect(outcome.result).toBeNull();
    expect(outcome.error).toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int FROM component_project_mappings WHERE organization_id = ${target.org.id}::uuid`).toEqual([{ count: 0 }]);
    expect(await prisma.adminMutation.count({ where: { organizationId: target.org.id, action: 'COMPONENT_PROJECT_IMPORT_ROW' } })).toBe(0);
    await expect(service.importComponents(f.actor, target.org.id, body, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
  });
});
