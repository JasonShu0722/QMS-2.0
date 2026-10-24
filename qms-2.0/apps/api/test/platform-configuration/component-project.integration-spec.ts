import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Component project tests require disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(120_000);

describe('component project mapping with real PostgreSQL / HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const csrf = randomUUID();
  const base = '/api/v1/admin/configuration';
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app?.close(); });

  async function fixture(codes = ['component-project:read', 'component-project:manage'], type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'N2 isolated fixture', type } });
    const user = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: type } });
    const permissions = await Promise.all(codes.map((code) => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'N2 test role', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: role.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = (await app.get(SessionService).resolve(token))!;
    return { org, user, role, cookie: `qms_session=${token}; qms_csrf=${csrf}`, actor: { ...session.user, sessionId: session.id } };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function get(f: Fixture, path: string, query: object = {}) {
    return request(app.getHttpServer()).get(`${base}/${path}`).set('Cookie', f.cookie).query({ organizationId: f.org.id, ...query });
  }
  function write(f: Fixture, method: 'post' | 'patch', path: string, body: object, key = randomUUID()) {
    return request(app.getHttpServer())[method](`${base}/${path}`).query({ organizationId: f.org.id }).set('Cookie', f.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }
  async function project(f: Fixture, body: object = {}) {
    return (await write(f, 'post', 'component-project-records', { code: randomUUID(), name: 'Project', stage: 'NEW_PRODUCT', ...body }).expect(201)).body;
  }
  async function mapping(f: Fixture, projectRecordId: string, body: object = {}) {
    return (await write(f, 'post', 'component-project-mappings', { componentCode: randomUUID(), projectRecordId, productCategory: 'Powertrain', ...body }).expect(201)).body;
  }
  async function engineer(f: Fixture, startedAt = new Date(Date.now() - 60_000), endedAt: Date | null = null) {
    const user = await prisma.user.create({ data: { organizationId: f.org.id, username: randomUUID(), fullName: 'N2 Engineer', accountType: 'INTERNAL', passwordHash: 'unused' } });
    const department = await prisma.department.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Engineering' } });
    const position = await prisma.position.create({ data: { organizationId: f.org.id, departmentId: department.id, code: randomUUID(), name: 'Not a permission name' } });
    const assignment = await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: user.id, positionId: position.id, startedAt, endedAt } });
    return { user, department, position, assignment };
  }

  it('owns two mapping tables without a legacy new-product project dependency', async () => {
    const tables = await prisma.$queryRaw<{ records: string | null; mappings: string | null }[]>`SELECT to_regclass('component_project_records')::text AS records, to_regclass('component_project_mappings')::text AS mappings`;
    expect(tables[0]).toEqual({ records: 'component_project_records', mappings: 'component_project_mappings' });
    const foreign = await prisma.$queryRaw<{ target: string; deletion: string; update: string }[]>`SELECT confrelid::regclass::text AS target, confdeltype::text AS deletion, confupdtype::text AS update FROM pg_constraint WHERE conrelid IN (to_regclass('component_project_records'), to_regclass('component_project_mappings')) AND contype = 'f'`;
    expect(foreign.some(({ target }) => target === 'new_product_projects')).toBe(false);
    expect(foreign.length).toBeGreaterThan(3);
    expect(foreign.every(({ deletion, update }) => deletion === 'r' && update === 'r')).toBe(true);
  });

  it('returns project summaries with mapping pages and scoped detail for an off-page selection', async () => {
    const f = await fixture();
    const first = await project(f, { code: 'A-PROJECT', name: 'First project' });
    const selected = await project(f, { code: 'Z-PROJECT', name: '\u{20000}'.repeat(200), stage: 'MASS_PRODUCTION', status: 'DISABLED' });
    await mapping(f, selected.id, { componentCode: 'OFF-PAGE-COMPONENT' });
    expect((await get(f, 'component-project-records', { page: 1, pageSize: 1 }).expect(200)).body.items[0].id).toBe(first.id);
    expect((await get(f, `component-project-records/${selected.id}`).expect(200)).body).toEqual(selected);
    const page = (await get(f, 'component-project-mappings', { page: 1, pageSize: 1 }).expect(200)).body;
    expect(page.items[0].project).toMatchObject({ id: selected.id, code: selected.code, name: selected.name, stage: 'MASS_PRODUCTION', status: 'DISABLED' });
    const created = await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: selected.id, action: 'COMPONENT_PROJECT_CREATED' } });
    expect(created.metadata).toMatchObject({ componentProjectName: selected.name });
    const other = await fixture();
    await get(other, `component-project-records/${selected.id}`).expect(404);
    await get(f, `component-project-records/${randomUUID()}`).expect(404);
    await get(f, 'component-project-records/not-a-uuid').expect(400);
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id, permission: { code: 'component-project:manage' } } });
    await get(f, `component-project-records/${selected.id}`).expect(200);
    await write(f, 'patch', `component-project-records/${selected.id}`, { expectedVersion: 1, name: 'Denied' }).expect(403);
  });

  it('projects both engineer identities and invalidity in the component page without substituting people', async () => {
    const f = await fixture();
    const customer = await engineer(f);
    const quality = await engineer(f);
    await prisma.user.update({ where: { id: customer.user.id }, data: { fullName: 'Customer engineer' } });
    await prisma.user.update({ where: { id: quality.user.id }, data: { fullName: 'Project engineer' } });
    const record = await project(f, { customerEngineerAssignmentId: customer.assignment.id, projectEngineerAssignmentId: quality.assignment.id });
    await mapping(f, record.id, { componentCode: 'CONTROL' });
    await mapping(f, record.id, { componentCode: 'DRIVE' });
    const page = () => get(f, 'component-project-mappings', { pageSize: 100 }).expect(200);
    for (const row of (await page()).body.items) {
      expect(row.project.customerEngineer).toMatchObject({ assignmentId: customer.assignment.id, userId: customer.user.id, fullName: 'Customer engineer', valid: true });
      expect(row.project.projectEngineer).toMatchObject({ assignmentId: quality.assignment.id, userId: quality.user.id, fullName: 'Project engineer', valid: true });
    }
    await prisma.user.update({ where: { id: customer.user.id }, data: { status: 'DISABLED' } });
    const changed = (await page()).body.items[0].project;
    expect(changed.customerEngineer).toMatchObject({ assignmentId: customer.assignment.id, userId: customer.user.id, fullName: 'Customer engineer', valid: false, issues: ['USER_DISABLED'] });
    expect(changed.projectEngineer).toMatchObject({ assignmentId: quality.assignment.id, valid: true });
    await write(f, 'patch', `component-project-records/${record.id}`, { expectedVersion: 1, customerEngineerAssignmentId: null }).expect(200);
    expect((await page()).body.items[0].project.customerEngineer).toMatchObject({ assignmentId: null, userId: null, valid: false, issues: ['ENGINEER_NOT_CONFIGURED'] });
  });

  it('shares stage and both nullable engineers across two components with different classifications', async () => {
    const f = await fixture();
    const c = await engineer(f);
    const p = await engineer(f);
    const record = await project(f, { code: '  Prj-a  ', customerEngineerAssignmentId: c.assignment.id, projectEngineerAssignmentId: p.assignment.id });
    expect(record).toMatchObject({ code: 'Prj-a', stage: 'NEW_PRODUCT', version: 1 });
    await mapping(f, record.id, { componentCode: '  abc-X  ', productCategory: 'Drive', productSubcategory: 'Shaft' });
    await mapping(f, record.id, { componentCode: 'abc-Y', productCategory: 'Body', productSubcategory: null });
    for (const componentCode of ['abc-X', 'abc-Y']) {
      const resolved = (await get(f, 'component-project-mappings/resolve', { componentCode }).expect(200)).body;
      expect(resolved).toMatchObject({ outcome: 'matched', project: { id: record.id, stage: 'NEW_PRODUCT' }, customerEngineer: { assignmentId: c.assignment.id, userId: c.user.id, positionId: c.position.id, valid: true }, projectEngineer: { assignmentId: p.assignment.id, userId: p.user.id, valid: true } });
    }
    await write(f, 'patch', `component-project-records/${record.id}`, { expectedVersion: 1, stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: null, projectEngineerAssignmentId: null }).expect(200);
    const resolved = (await get(f, 'component-project-mappings/resolve', { componentCode: 'abc-X' }).expect(200)).body;
    expect(resolved).toMatchObject({ project: { version: 2, stage: 'MASS_PRODUCTION' }, customerEngineer: { assignmentId: null, userId: null }, projectEngineer: { assignmentId: null, userId: null } });
  });

  it('rejects duplicate trimmed codes without uppercasing or guessing a stage, and validates all input', async () => {
    const f = await fixture();
    const record = await project(f, { code: 'Ab-c' });
    await write(f, 'post', 'component-project-records', { code: ' Ab-c ', name: 'Duplicate', stage: 'NEW_PRODUCT' }).expect(409);
    await project(f, { code: 'ab-c' });
    for (const body of [
      { code: 'x', name: 'x' }, { code: ' ', name: 'x', stage: 'NEW_PRODUCT' },
      { code: 'x'.repeat(101), name: 'x', stage: 'NEW_PRODUCT' }, { code: 'x', name: 'x'.repeat(201), stage: 'NEW_PRODUCT' },
      { code: 'x', name: 'x', stage: 'GUESS' }, { code: 'x', name: 'x', stage: 'NEW_PRODUCT', status: null },
      { code: 'x', name: 'x', stage: 'NEW_PRODUCT', extra: 'forbidden' },
    ]) await write(f, 'post', 'component-project-records', body).expect(400);
    await mapping(f, record.id, { componentCode: 'C-1' });
    await write(f, 'post', 'component-project-mappings', { componentCode: ' C-1 ', projectRecordId: record.id, productCategory: 'Other' }).expect(409);
    for (const body of [
      { componentCode: 'x'.repeat(101) }, { productCategory: ' ' }, { productCategory: 'x'.repeat(101) },
      { productSubcategory: 'x'.repeat(101) }, { projectRecordId: null }, { stage: 'NEW_PRODUCT' },
    ]) await write(f, 'post', 'component-project-mappings', { componentCode: randomUUID(), projectRecordId: record.id, productCategory: 'Valid', ...body }).expect(400);
    for (const body of [{ code: null }, { stage: null }, { name: null }, { expectedVersion: 0 }, { expectedVersion: 2147483648 }]) {
      await write(f, 'patch', `component-project-records/${record.id}`, { expectedVersion: 1, ...body }).expect(400);
    }
  });

  it('returns unmapped then immediately recovers, preserving manual engineers and clearing differences', async () => {
    const f = await fixture();
    const c = await engineer(f);
    const manualId = randomUUID();
    const query = { componentCode: 'Late-Mapping', currentQualityEngineerId: manualId, currentQualityEngineerSource: 'MANUAL' };
    expect((await get(f, 'component-project-mappings/resolve', query).expect(200)).body).toMatchObject({ outcome: 'unmapped', effectiveQualityEngineerId: manualId });
    const record = await project(f, { stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: c.assignment.id });
    const m = await mapping(f, record.id, { componentCode: query.componentCode });
    const first = (await get(f, 'component-project-mappings/resolve', query).expect(200)).body;
    expect(first).toMatchObject({ outcome: 'matched', mapping: { id: m.id, version: 1 }, effectiveQualityEngineerId: manualId, suggestedQualityEngineerId: c.user.id, engineerDifference: true });
    expect((await get(f, 'component-project-mappings/resolve', { ...query, currentQualityEngineerId: c.user.id }).expect(200)).body.engineerDifference).toBe(false);
    expect((await get(f, 'component-project-mappings/resolve', { componentCode: query.componentCode }).expect(200)).body.effectiveQualityEngineerId).toBe(c.user.id);
    await write(f, 'patch', `component-project-records/${record.id}`, { expectedVersion: 1, customerEngineerAssignmentId: null }).expect(200);
    expect((await get(f, 'component-project-mappings/resolve', { componentCode: query.componentCode }).expect(200)).body.effectiveQualityEngineerId).toBeNull();
    await write(f, 'patch', `component-project-records/${record.id}`, { expectedVersion: 2, customerEngineerAssignmentId: c.assignment.id }).expect(200);
    expect((await get(f, 'component-project-mappings/resolve', { componentCode: query.componentCode, currentQualityEngineerSource: 'MANUAL' }).expect(200)).body.effectiveQualityEngineerId).toBe(c.user.id);
  });

  it('suggests the project engineer for new products and the customer engineer for mass production, without fallback', async () => {
    const f = await fixture();
    const c = await engineer(f);
    const p = await engineer(f);
    const record = await project(f, { customerEngineerAssignmentId: c.assignment.id, projectEngineerAssignmentId: p.assignment.id });
    await mapping(f, record.id, { componentCode: 'Stage-based' });
    expect((await get(f, 'component-project-mappings/resolve', { componentCode: 'Stage-based' }).expect(200)).body.suggestedQualityEngineerId).toBe(p.user.id);
    await write(f, 'patch', `component-project-records/${record.id}`, { expectedVersion: 1, projectEngineerAssignmentId: null }).expect(200);
    expect((await get(f, 'component-project-mappings/resolve', { componentCode: 'Stage-based' }).expect(200)).body.suggestedQualityEngineerId).toBeNull();
    await write(f, 'patch', `component-project-records/${record.id}`, { expectedVersion: 2, stage: 'MASS_PRODUCTION' }).expect(200);
    expect((await get(f, 'component-project-mappings/resolve', { componentCode: 'Stage-based' }).expect(200)).body.suggestedQualityEngineerId).toBe(c.user.id);
  });

  it('supports read-only transactional resolution and rechecks service scope and grants on every call', async () => {
    const f = await fixture();
    const other = await fixture();
    const service = app.get(ComponentProjectService);
    const record = await project(f);
    await mapping(f, record.id, { componentCode: 'Transactional' });
    const before = await prisma.adminMutation.count({ where: { organizationId: f.org.id } });
    const resolved = await prisma.$transaction((transaction) => service.resolve(f.actor, f.org.id, { componentCode: 'Transactional' }, transaction));
    expect(resolved).toMatchObject({ outcome: 'matched', project: { id: record.id } });
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id } })).toBe(before);
    await expect(service.resolve(f.actor, other.org.id, { componentCode: 'Transactional' })).rejects.toMatchObject({ status: 403 });
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
    await expect(service.resolve(f.actor, f.org.id, { componentCode: 'Transactional' })).rejects.toMatchObject({ status: 403 });
    await expect(service.createProject(f.actor, f.org.id, { code: 'Denied', name: 'Denied', stage: 'NEW_PRODUCT' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
  });

  it('rolls back data and idempotency receipts when the success audit fails', async () => {
    const f = await fixture();
    const record = await project(f);
    const key = randomUUID();
    const service = new ComponentProjectService(prisma, app.get(AdminMutationService), { record: async () => { throw new Error('audit unavailable'); } } as never, app.get(OrganizationService));
    await expect(service.updateProject(f.actor, f.org.id, record.id, { expectedVersion: 1, name: 'Must rollback' }, randomUUID(), key)).rejects.toThrow('audit unavailable');
    expect((await get(f, 'component-project-records').expect(200)).body.items[0]).toMatchObject({ name: 'Project', version: 1 });
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id, key } })).toBe(0);
  });

  it('validates concrete appointments and reports stale choices without substituting another person', async () => {
    const f = await fixture();
    const other = await fixture();
    const c = await engineer(f);
    const foreign = await engineer(other);
    const expired = await engineer(f, new Date(Date.now() - 120_000), new Date(Date.now() - 60_000));
    const future = await engineer(f, new Date(Date.now() + 86_400_000));
    for (const id of [foreign.assignment.id, expired.assignment.id, future.assignment.id, randomUUID()]) {
      await write(f, 'post', 'component-project-records', { code: randomUUID(), name: 'Invalid assignment', stage: 'NEW_PRODUCT', customerEngineerAssignmentId: id }).expect(409);
    }
    const record = await project(f, { customerEngineerAssignmentId: c.assignment.id, projectEngineerAssignmentId: c.assignment.id });
    const m = await mapping(f, record.id, { componentCode: 'Retained' });
    await prisma.userPosition.update({ where: { id: c.assignment.id }, data: { endedAt: new Date(Date.now() - 1_000) } });
    const resolved = (await get(f, 'component-project-mappings/resolve', { componentCode: m.componentCode }).expect(200)).body;
    expect(resolved).toMatchObject({ outcome: 'matched', customerEngineer: { assignmentId: c.assignment.id, userId: c.user.id, valid: false }, effectiveQualityEngineerId: null });
    expect(resolved.customerEngineer.issues).toContain('ASSIGNMENT_ENDED');
    const choices = (await get(f, 'component-project-mappings/engineer-assignments', { selectedAssignmentId: c.assignment.id }).expect(200)).body;
    expect(choices.items.some((item: { assignmentId: string }) => item.assignmentId === c.assignment.id)).toBe(false);
    expect(choices.selected).toMatchObject({ assignmentId: c.assignment.id, valid: false });
    for (const target of ['user', 'position', 'department'] as const) {
      await prisma.userPosition.update({ where: { id: c.assignment.id }, data: { endedAt: null } });
      if (target === 'user') await prisma.user.update({ where: { id: c.user.id }, data: { status: 'DISABLED' } });
      if (target === 'position') await prisma.position.update({ where: { id: c.position.id }, data: { status: 'DISABLED' } });
      if (target === 'department') await prisma.department.update({ where: { id: c.department.id }, data: { status: 'DISABLED' } });
      await write(f, 'patch', `component-project-records/${record.id}`, { expectedVersion: 1, projectEngineerAssignmentId: c.assignment.id }).expect(409);
      await prisma.user.update({ where: { id: c.user.id }, data: { status: 'ACTIVE' } });
      await prisma.position.update({ where: { id: c.position.id }, data: { status: 'ACTIVE' } });
      await prisma.department.update({ where: { id: c.department.id }, data: { status: 'ACTIVE' } });
    }
    await prisma.user.update({ where: { id: c.user.id }, data: { accountType: 'SUPPLIER' } });
    await write(f, 'patch', `component-project-records/${record.id}`, { expectedVersion: 1, projectEngineerAssignmentId: c.assignment.id }).expect(409);
    await expect(prisma.$executeRaw`UPDATE component_project_records SET customer_engineer_assignment_id = ${foreign.assignment.id}::uuid WHERE id = ${record.id}::uuid`).rejects.toThrow();
  });

  it('uses CAS, idempotent receipts and one atomic success audit, including concurrent duplicate codes', async () => {
    const f = await fixture();
    const body = { code: 'Replay', name: 'Replay project', stage: 'NEW_PRODUCT' };
    const key = randomUUID();
    const created = (await write(f, 'post', 'component-project-records', body, key).expect(201)).body;
    expect((await write(f, 'post', 'component-project-records', body, key).expect(201)).body).toEqual(created);
    await write(f, 'post', 'component-project-records', { ...body, name: 'Different' }, key).expect(409);
    const m = await mapping(f, created.id);
    const update = { expectedVersion: 1, name: 'Edited' };
    const patchKey = randomUUID();
    const edited = (await write(f, 'patch', `component-project-records/${created.id}`, update, patchKey).expect(200)).body;
    expect((await write(f, 'patch', `component-project-records/${created.id}`, update, patchKey).expect(200)).body).toEqual(edited);
    await write(f, 'patch', `component-project-records/${created.id}`, update).expect(409);
    await write(f, 'patch', `component-project-mappings/${m.id}`, { expectedVersion: 1, productSubcategory: 'Before clear' }).expect(200);
    expect((await write(f, 'patch', `component-project-mappings/${m.id}`, { expectedVersion: 2, productSubcategory: null }).expect(200)).body).toMatchObject({ version: 3, productSubcategory: null });
    await write(f, 'patch', `component-project-mappings/${m.id}`, { expectedVersion: 2 }).expect(409);
    expect(await prisma.auditEvent.count({ where: { resourceId: created.id, action: 'COMPONENT_PROJECT_CREATED', outcome: 'SUCCESS' } })).toBe(1);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: created.id, action: 'COMPONENT_PROJECT_UPDATED' } });
    expect(audit.metadata).toMatchObject({ resourceVersion: 2 });
    const results = await Promise.all([write(f, 'post', 'component-project-records', { ...body, code: 'Concurrent' }), write(f, 'post', 'component-project-records', { ...body, code: 'Concurrent' })]);
    expect(results.map(({ status }) => status).sort()).toEqual([201, 409]);
    const mappings = await Promise.all([write(f, 'post', 'component-project-mappings', { componentCode: 'Concurrent', productCategory: 'Test', projectRecordId: created.id }), write(f, 'post', 'component-project-mappings', { componentCode: 'Concurrent', productCategory: 'Test', projectRecordId: created.id })]);
    expect(mappings.map(({ status }) => status).sort()).toEqual([201, 409]);
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
    await write(f, 'post', 'component-project-records', body, key).expect(403);
  });

  it('keeps disabled mapping/project records and returns inactive without auto assignment', async () => {
    const f = await fixture();
    const record = await project(f);
    const m = await mapping(f, record.id, { componentCode: 'Inactive' });
    await write(f, 'patch', `component-project-mappings/${m.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    expect((await get(f, 'component-project-mappings/resolve', { componentCode: m.componentCode }).expect(200)).body).toMatchObject({ outcome: 'inactive', mapping: { id: m.id, version: 2, status: 'DISABLED' }, project: { id: record.id }, effectiveQualityEngineerId: null });
    await write(f, 'patch', `component-project-mappings/${m.id}`, { expectedVersion: 2, status: 'ACTIVE' }).expect(200);
    await write(f, 'patch', `component-project-records/${record.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    expect((await get(f, 'component-project-mappings/resolve', { componentCode: m.componentCode }).expect(200)).body.outcome).toBe('inactive');
    expect((await get(f, 'component-project-mappings').expect(200)).body.total).toBe(1);
  });

  it('audits exact before/after values for every editable project and mapping field, including nullable clears', async () => {
    const f = await fixture();
    const c = await engineer(f);
    const p = await engineer(f);
    const code = `a/${'x'.repeat(98)}`;
    const record = await project(f, { code, customerEngineerAssignmentId: c.assignment.id });
    const m = await mapping(f, record.id, { componentCode: code, productCategory: 'Before category', productSubcategory: 'Before subcategory' });
    const next = await project(f);
    const event = (resourceId: string, action: string) => prisma.auditEvent.findFirstOrThrow({ where: { resourceId, action, outcome: 'SUCCESS' } });
    expect((await event(record.id, 'COMPONENT_PROJECT_CREATED')).metadata).toMatchObject({
      resourceVersion: 1, componentProjectId: record.id, componentProjectCode: code, componentProjectName: 'Project',
      componentProjectStage: 'NEW_PRODUCT', customerEngineerAssignmentId: c.assignment.id, projectEngineerAssignmentId: null, status: 'ACTIVE',
    });
    await write(f, 'patch', `component-project-records/${record.id}`, { expectedVersion: 1, code: 'Updated/Project', name: 'Updated name', stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: null, projectEngineerAssignmentId: p.assignment.id, status: 'DISABLED' }).expect(200);
    expect((await event(record.id, 'COMPONENT_PROJECT_UPDATED')).metadata).toEqual({
      resourceVersion: 2, componentProjectId: record.id, componentProjectCode: 'Updated/Project', previousComponentProjectCode: code,
      componentProjectName: 'Updated name', previousComponentProjectName: 'Project', componentProjectStage: 'MASS_PRODUCTION', previousComponentProjectStage: 'NEW_PRODUCT',
      customerEngineerAssignmentId: null, previousCustomerEngineerAssignmentId: c.assignment.id,
      projectEngineerAssignmentId: p.assignment.id, previousProjectEngineerAssignmentId: null, status: 'DISABLED', previousStatus: 'ACTIVE',
    });
    expect((await event(m.id, 'COMPONENT_PROJECT_MAPPING_CREATED')).metadata).toMatchObject({
      resourceVersion: 1, componentCode: code, projectRecordId: record.id, productCategory: 'Before category', productSubcategory: 'Before subcategory', status: 'ACTIVE',
    });
    await write(f, 'patch', `component-project-mappings/${m.id}`, { expectedVersion: 1, componentCode: 'Updated/Component', projectRecordId: next.id, productCategory: 'After category', productSubcategory: null, status: 'DISABLED' }).expect(200);
    expect((await event(m.id, 'COMPONENT_PROJECT_MAPPING_UPDATED')).metadata).toEqual({
      componentName: null, previousComponentName: null,
      resourceVersion: 2, componentCode: 'Updated/Component', previousComponentCode: code, projectRecordId: next.id, previousProjectRecordId: record.id,
      productCategory: 'After category', previousProductCategory: 'Before category', productSubcategory: null, previousProductSubcategory: 'Before subcategory', status: 'DISABLED', previousStatus: 'ACTIVE',
    });
  });

  it('paginates both lists and candidate search without granting configuration authority', async () => {
    const f = await fixture();
    const record = await project(f);
    await project(f);
    await mapping(f, record.id);
    await mapping(f, record.id);
    for (const path of ['component-project-records', 'component-project-mappings']) {
      const first = (await get(f, path, { page: 1, pageSize: 1 }).expect(200)).body;
      const second = (await get(f, path, { page: 2, pageSize: 1 }).expect(200)).body;
      expect(first).toMatchObject({ total: 2, page: 1, pageSize: 1 });
      expect(first.items).toHaveLength(1);
      expect(second.items).toHaveLength(1);
      expect(first.items[0].id).not.toBe(second.items[0].id);
      await get(f, path, { pageSize: 101 }).expect(400);
    }
    await engineer(f);
    await engineer(f);
    const choices = (await get(f, 'component-project-mappings/engineer-assignments', { search: 'N2 Engineer', page: 2, pageSize: 1 }).expect(200)).body;
    expect(choices).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(choices.items).toHaveLength(1);
    await get(f, 'settings').expect(403);
    const config = await fixture(['configuration:read', 'configuration:manage']);
    await get(config, 'component-project-records').expect(403);
    const read = await fixture(['component-project:read']);
    await get(read, 'component-project-records').expect(200);
    await write(read, 'post', 'component-project-records', { code: 'Denied', name: 'Denied', stage: 'NEW_PRODUCT' }).expect(403);
    const manage = await fixture(['component-project:manage']);
    await project(manage);
    await get(manage, 'component-project-records').expect(403);
  });

  it('requires HTTP session/CSRF and rejects foreign resources with 404 even for a scoped manager', async () => {
    const f = await fixture();
    const other = await fixture();
    const record = await project(other);
    const m = await mapping(other, record.id);
    await request(app.getHttpServer()).get(`${base}/component-project-records`).expect(401);
    await request(app.getHttpServer()).post(`${base}/component-project-records`).set('Cookie', f.cookie).send({}).expect(403);
    await write(f, 'patch', `component-project-records/${record.id}`, { expectedVersion: 1, name: 'Foreign' }).expect(404);
    await write(f, 'patch', `component-project-mappings/${m.id}`, { expectedVersion: 1, productCategory: 'Foreign' }).expect(404);
    await write(f, 'post', 'component-project-mappings', { componentCode: 'Foreign', projectRecordId: record.id, productCategory: 'Foreign' }).expect(404);
    await get(f, 'component-project-records', { organizationId: other.org.id }).expect(403);
    const supplier = await fixture(undefined, 'SUPPLIER');
    await get(supplier, 'component-project-records').expect(403);
    await project(f);
    await prisma.organization.update({ where: { id: f.org.id }, data: { status: 'DISABLED' } });
    await get(f, 'component-project-records').expect(401);
  });
});
