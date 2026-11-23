import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('Disposable PostgreSQL is required');

describe('process defect ledger HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  const csrf = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.organization.create({ data: { id: organizationId, code: `PD-HTTP-${organizationId.slice(0, 8)}`, name: 'Process HTTP', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: userId, organizationId, username: `pqe-${userId.slice(0, 8)}`, passwordHash: 'test-only', accountType: 'INTERNAL' } });
    const role = await prisma.role.create({ data: { organizationId, code: 'PQE', name: 'Process QE' } });
    for (const code of ['process-quality:defects:read', 'process-quality:defects:write', 'process-quality:defects:delete']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId: role.id } });
    cookie = `qms_session=${await app.get(SessionService).create(userId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
  });

  afterAll(async () => { await app?.close(); });

  function send(method: 'post' | 'put', path: string, body: object) {
    return request(app.getHttpServer())[method](`/api/v1/process-quality/${path}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body);
  }

  function list(query: Record<string, string | number>) {
    return request(app.getHttpServer()).get('/api/v1/process-quality/defects').set('Cookie', cookie).query(query);
  }

  it('documents the encoded filter and the typed model without changing the list route', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const parameters = document.paths['/api/v1/process-quality/defects']!.get!.parameters;
    expect(parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'filters', in: 'query', required: false, schema: expect.objectContaining({ type: 'string' }) }),
      expect.objectContaining({ name: 'occurredFrom', schema: { type: 'string', format: 'date-time' } }),
      expect.objectContaining({ name: 'occurredTo', schema: { type: 'string', format: 'date-time' } }),
    ]));
    expect(document.components!.schemas!.ProcessDefectFiltersDto).toMatchObject({ properties: { logic: { enum: ['ALL', 'ANY'] }, items: { minItems: 1, maxItems: 10 } } });
    expect(document.components!.schemas!.ProcessDefectFilterDto).toMatchObject({ properties: {
      field: { enum: expect.arrayContaining(['projectCode', 'projectStage', 'defectQuantity', 'pendingCompletion', 'factoryCode', 'productCategory']) },
      operator: { enum: expect.arrayContaining(['NE', 'NOT_CONTAINS', 'BEFORE', 'LTE', 'EMPTY']) },
      value: { oneOf: [{ type: 'string' }, { type: 'integer' }, { type: 'boolean' }] },
    } });
    const schemas = document.components!.schemas!;
    const factory = { type: 'string', enum: ['FACTORY_1', 'FACTORY_2'] };
    expect(schemas.CreateProcessDefectDto).toMatchObject({ required: expect.arrayContaining(['factoryCode']), properties: { factoryCode: factory } });
    expect(schemas.UpdateProcessDefectDto).toMatchObject({ required: expect.not.arrayContaining(['factoryCode']), properties: { factoryCode: factory } });
    expect(schemas.ProcessDefectDto).toMatchObject({ required: expect.arrayContaining(['factoryCode']), properties: { factoryCode: { ...factory, nullable: true } } });
  });

  it('uses one scoped predicate for the persisted project stage, combined conditions, rows and total', async () => {
    const project = { id: randomUUID(), version: 1, code: 'FILTER-PROJECT', name: '历史项目', status: 'ACTIVE' };
    const snapshot = (stage: string) => ({ componentCode: 'COMP', associatedAt: '2026-11-01T00:00:00Z', mapping: { id: randomUUID(), version: 1 }, project: { ...project, stage } });
    const other = await prisma.organization.create({ data: { code: `OTHER-${randomUUID()}`, name: 'Other', type: 'INTERNAL' } });
    const [recent, boundary, older, mass, blank] = Array.from({ length: 5 }, () => randomUUID());
    const base = { organizationId, createdById: userId, updatedById: userId, ledgerStatus: 'FOLLOWING', productCode: 'COMP', description: 'FilterScope 100%_A' };
    const at = (value: string) => new Date(value);
    await prisma.processDefect.createMany({ data: [
      { ...base, id: recent, projectCode: 'MANUAL-PROJECT', projectSnapshot: snapshot('NEW_PRODUCT'), occurredAt: at('2026-11-01T00:00:00.001+08:00'), defectQuantity: 7, lineName: '' },
      { ...base, id: boundary, projectSnapshot: snapshot('NEW_PRODUCT'), occurredAt: at('2026-11-01T00:00:00+08:00'), defectQuantity: 2, lineName: 'Line A' },
      { ...base, id: older, projectSnapshot: snapshot('NEW_PRODUCT'), occurredAt: at('2026-10-31T23:59:59.999+08:00'), defectQuantity: 1, description: 'OtherScope 100xxA' },
      { ...base, id: mass, projectSnapshot: snapshot('MASS_PRODUCTION'), occurredAt: at('2026-11-05T00:00:00+08:00'), defectQuantity: 8, description: 'FilterScope 100XYA', responsibilityCategory: 'MATERIAL' },
      { ...base, id: blank, description: 'FilterScope', pendingCompletion: true },
      { ...base, organizationId: other.id, projectSnapshot: snapshot('NEW_PRODUCT'), occurredAt: at('2026-11-01T00:00:00Z'), defectQuantity: 7 },
      { ...base, archivedAt: new Date(), projectSnapshot: snapshot('NEW_PRODUCT'), occurredAt: at('2026-11-01T00:00:00Z'), defectQuantity: 7 },
      { ...base, occurredAt: at('2026-12-01T00:00:00+08:00'), description: 'MonthScope', pendingCompletion: true },
    ] });
    await prisma.$executeRaw`INSERT INTO process_defect_material_items (id, organization_id, defect_id, position, material_code, created_by_id, updated_by_id)
      VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${boundary}::uuid, 0, 'MAT-A', ${userId}::uuid, ${userId}::uuid),
             (${randomUUID()}::uuid, ${organizationId}::uuid, ${boundary}::uuid, 1, 'MAT-B', ${userId}::uuid, ${userId}::uuid),
             (${randomUUID()}::uuid, ${organizationId}::uuid, ${mass}::uuid, 0, 'MAT-B', ${userId}::uuid, ${userId}::uuid)`;
    const condition = (field: string, operator: string, value?: string | number | boolean) => ({ field, operator, value });
    const filters = (logic: string, ...items: ReturnType<typeof condition>[]) => JSON.stringify({ logic, items });
    const results = async (logic: string, ...items: ReturnType<typeof condition>[]) => {
      const result = await list({ search: 'FilterScope', filters: filters(logic, ...items) }).expect(200);
      expect(result.body.total).toBe(result.body.items.length);
      return result.body.items.map((row: { id: string }) => row.id);
    };
    const after = '2026-11-01T00:00:00+08:00';
    const stage = condition('projectStage', 'EQ', 'NEW_PRODUCT');
    for (const [page, ids] of [[1, [recent]], [2, [boundary]], [3, []]] as const) {
      const response = await list({ page, pageSize: 1, search: 'FilterScope', filters: filters('ALL', stage, condition('defectQuantity', 'GTE', 2)) }).expect(200);
      expect(response.body).toMatchObject({ page, pageSize: 1, total: 2, items: ids.map(id => ({ id, projectStage: 'NEW_PRODUCT' })) });
      expect(response.body.items).toHaveLength(ids.length);
    }
    expect(await results('ANY', stage, condition('pendingCompletion', 'EQ', true))).toEqual([recent, boundary, blank]);
    expect(await results('ALL', stage, condition('projectCode', 'EQ', 'FILTER-PROJECT'))).toEqual([recent, boundary]);
    const manualProject = await list({ projectCode: 'MANUAL-PROJECT', search: 'FilterScope' }).expect(200);
    expect(manualProject.body).toMatchObject({ total: 1, items: [{ id: recent }] });
    expect(await results('ALL', condition('description', 'CONTAINS', '100%_a'), condition('occurredAt', 'AFTER', after))).toEqual([recent]);
    expect(await results('ALL', condition('description', 'NOT_CONTAINS', '%_'), condition('projectStage', 'NE', 'NEW_PRODUCT'))).toEqual([mass]);
    expect(await results('ALL', condition('description', 'EQ', 'filterscope 100%_a'), condition('occurredAt', 'EQ', after))).toEqual([boundary]);
    expect(await results('ALL', condition('description', 'NE', 'FilterScope'), condition('occurredAt', 'NE', after))).toEqual([mass, recent]);
    expect(await results('ALL', condition('occurredAt', 'BEFORE', '2026-10-31T16:00:00.001Z'))).toEqual([boundary]);
    expect(await results('ALL', condition('occurredAt', 'EQ', '2026-11-01'))).toEqual([recent, boundary]);
    expect(await results('ALL', condition('occurredAt', 'NE', '2026-11-01'))).toEqual([mass]);
    expect(await results('ALL', condition('occurredAt', 'AFTER', '2026-11-01'))).toEqual([mass]);
    expect(await results('ALL', condition('occurredAt', 'BEFORE', '2026-11-01'))).toEqual([]);
    expect(await results('ALL', condition('occurredAt', 'EMPTY'), condition('defectQuantity', 'EMPTY'), condition('projectStage', 'EMPTY'))).toEqual([blank]);
    expect(await results('ALL', condition('occurredAt', 'NOT_EMPTY'), condition('lineName', 'NOT_EMPTY'), condition('projectStage', 'NOT_EMPTY'))).toEqual([boundary]);
    expect(await results('ALL', condition('lineName', 'EMPTY'), condition('defectQuantity', 'GT', 0), condition('defectQuantity', 'LT', 8))).toEqual([recent]);
    expect(await results('ALL', condition('responsibilityCategory', 'NOT_EMPTY'), condition('defectQuantity', 'NE', 0), condition('defectQuantity', 'LTE', 8))).toEqual([mass]);
    expect(await results('ALL', condition('responsibilityCategory', 'EMPTY'), condition('defectQuantity', 'NOT_EMPTY'), condition('defectQuantity', 'EQ', 2))).toEqual([boundary]);
    expect(await results('ALL', condition('materialCode', 'EQ', 'mat-b'))).toEqual([mass, boundary]);
    expect(await results('ALL', condition('materialCode', 'NE', 'mat-b'))).toEqual([]);
    expect(await results('ALL', condition('materialCode', 'EMPTY'))).toEqual([recent, blank]);
    const withLegacyMaterial = await list({ materialCode: 'MAT-B', search: 'FilterScope', filters: filters('ALL', stage) }).expect(200);
    expect(withLegacyMaterial.body).toMatchObject({ total: 1, items: [{ id: boundary }] });
    const month = await list({ occurredFrom: after, occurredTo: '2026-12-01T00:00:00+08:00', filters: filters('ANY', stage, condition('pendingCompletion', 'EQ', true)) }).expect(200);
    expect(month.body).toMatchObject({ total: 2, items: [{ id: recent }, { id: boundary }] });
    const legacy = await list({ page: 2, pageSize: 2, search: 'FilterScope', ledgerStatus: 'FOLLOWING' }).expect(200);
    expect(legacy.body).toMatchObject({ page: 2, pageSize: 2, total: 4, items: [{ id: boundary }, { id: blank }] });
  });

  it('filters persisted product categories with text operators, scoped combinations and server pagination', async () => {
    const productCode = randomUUID();
    const batchCode = randomUUID();
    const savedCategory = 'Drive 100%_A';
    const currentCategory = 'Current mapping';
    await prisma.$executeRaw`INSERT INTO component_project_mappings
      (organization_id, component_code, product_category, created_by_user_id, updated_by_user_id)
      VALUES (${organizationId}::uuid, ${productCode}, ${currentCategory}, ${userId}::uuid, ${userId}::uuid)`;
    const other = await prisma.organization.create({ data: { code: `OTHER-${randomUUID()}`, name: 'Other', type: 'INTERNAL' } });
    const [recent, older, pending, different, nullCategory, blankCategory] = Array.from({ length: 6 }, () => randomUUID());
    const base = { organizationId, createdById: userId, updatedById: userId, productCode, batchCode, description: 'Product category scope' };
    await prisma.processDefect.createMany({ data: [
      { ...base, id: recent, productCategory: savedCategory, occurredAt: new Date('2026-11-06T00:00:00Z') },
      { ...base, id: older, productCategory: 'drive 100%_a', occurredAt: new Date('2026-11-05T00:00:00Z') },
      { ...base, id: pending, productCategory: savedCategory, pendingCompletion: true, occurredAt: new Date('2026-11-04T00:00:00Z') },
      { ...base, id: different, productCategory: 'Drive 100xxA', occurredAt: new Date('2026-11-03T00:00:00Z') },
      { ...base, id: nullCategory, productCategory: null, productSubcategory: savedCategory, occurredAt: new Date('2026-11-02T00:00:00Z') },
      { ...base, id: blankCategory, productCategory: '', occurredAt: new Date('2026-11-01T00:00:00Z') },
      { ...base, organizationId: other.id, productCategory: savedCategory, pendingCompletion: true },
      { ...base, archivedAt: new Date(), productCategory: savedCategory },
    ] });
    const category = (operator: string, value?: string) => ({ field: 'productCategory', operator, value });
    const filters = (logic: 'ALL' | 'ANY', ...items: { field: string; operator: string; value?: string | boolean }[]) => JSON.stringify({ logic, items });
    const matching = category('EQ', 'DRIVE 100%_A');
    const combinations = filters('ALL', matching, { field: 'pendingCompletion', operator: 'EQ', value: false });
    for (const [page, ids] of [[1, [recent]], [2, [older]], [3, []]] as const) {
      const response = await list({ batchCode, filters: combinations, page, pageSize: 1 }).expect(200);
      expect(response.body).toMatchObject({ page, pageSize: 1, total: 2 });
      expect(response.body.items.map((row: { id: string }) => row.id)).toEqual(ids);
    }
    for (const [encoded, ids] of [
      [filters('ALL', category('CONTAINS', '100%_a')), [recent, older, pending]],
      [filters('ALL', category('NOT_CONTAINS', '100%_a')), [different]],
      [filters('ALL', category('NE', 'DRIVE 100%_A')), [different]],
      [filters('ALL', category('EMPTY')), [nullCategory, blankCategory]],
      [filters('ALL', category('NOT_EMPTY')), [recent, older, pending, different]],
      [filters('ALL', category('EQ', currentCategory)), []],
      [filters('ANY', matching, { field: 'productSubcategory', operator: 'EQ', value: savedCategory }), [recent, older, pending, nullCategory]],
    ] as const) {
      const response = await list({ batchCode, filters: encoded }).expect(200);
      expect(response.body.total).toBe(ids.length);
      expect(response.body.items.map((row: { id: string }) => row.id)).toEqual(ids);
    }
    await list({ organizationId: other.id, batchCode, filters: filters('ALL', matching) }).expect(403);
  });

  it('rejects malformed filters, unknown properties and invalid field/operator/value combinations', async () => {
    const valid = { field: 'projectStage', operator: 'EQ', value: 'NEW_PRODUCT' };
    for (const filters of [
      '{', JSON.stringify({ logic: 'ALL', items: [valid] }).repeat(100),
      ...[null, [], { logic: 'SOME', items: [valid] }, { logic: ['ALL'], items: [valid] }, { logic: 'ALL', items: [valid], extra: true }, { logic: 'ALL', items: [] }, { logic: 'ALL', items: Array(11).fill(valid) },
        ...[
          null, { ...valid, field: 'projectSnapshot.project.stage' }, { ...valid, field: '__proto__' }, { ...valid, field: 'constructor' }, { ...valid, operator: 'CONTAINS' }, { ...valid, value: 'ACTIVE' },
          { ...valid, operator: 'EMPTY' }, { ...valid, extra: true }, { field: 'occurredAt', operator: 'EQ', value: '2026-11-01T00:00:00' },
          { field: 'occurredAt', operator: 'EQ', value: '2026-02-30T00:00:00Z' }, { field: 'defectQuantity', operator: 'EQ', value: '0' },
          { field: 'defectQuantity', operator: 'GT', value: 2_147_483_648 }, { field: 'description', operator: 'CONTAINS', value: ' ' },
          { field: 'description', operator: 'CONTAINS', value: 'x\u0000y' },
        ].map(item => ({ logic: 'ALL', items: [item] })),
      ].map(item => JSON.stringify(item)),
    ]) await list({ filters }).expect(400);
    await request(app.getHttpServer()).get('/api/v1/process-quality/defects').set('Cookie', cookie)
      .query({ filters: [JSON.stringify({ logic: 'ALL', items: [valid] }), JSON.stringify({ logic: 'ANY', items: [valid] })] }).expect(400);
    await list({ occurredFrom: '2026-11-01T00:00:00' }).expect(400);
    await list({ occurredFrom: '2026-12-01T00:00:00Z', occurredTo: '2026-11-01T00:00:00Z' }).expect(400);
  });

  it('creates, queries, updates and archives a manual defect through protected routes', async () => {
    await send('post', 'defect-types', { code: 'BURR', name: '毛刺' }).expect(201);
    const input = { defectTypeCode: 'BURR', description: '端面毛刺', defectQuantity: 3, occurredAt: '2026-09-24T02:00:00Z', productCode: 'HTTP-P', traceCode: 'HTTP-T', batchCode: 'HTTP-B', responsibilityCategory: 'PROCESS', factoryCode: 'FACTORY_1' };
    const created = await send('post', 'defects', input).expect(201);
    expect(created.body.version).toBe(1);
    const listed = await request(app.getHttpServer()).get('/api/v1/process-quality/defects?batchCode=HTTP-B').set('Cookie', cookie).expect(200);
    expect(listed.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(true);
    await send('put', `defects/${created.body.id}`, { expectedVersion: 1, description: '复测毛刺' }).expect(200);
    await send('put', `defects/${created.body.id}/archive`, { expectedVersion: 2, reason: '登记错误确认删除' }).expect(200);
    const hidden = await request(app.getHttpServer()).get('/api/v1/process-quality/defects?batchCode=HTTP-B').set('Cookie', cookie).expect(200);
    expect(hidden.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(false);
  });

  it('validates manual factory and applies all enum operators to both rows and total', async () => {
    const batchCode = randomUUID();
    const input = { description: '工厂筛选', occurredAt: '2026-09-24T02:00:00Z', productCode: 'HTTP-P', traceCode: batchCode, batchCode };
    for (const factoryCode of [undefined, null, '', 'FACTORY_3']) {
      const invalid = await send('post', 'defects', { ...input, factoryCode }).expect(400);
      expect(invalid.body.fields).toMatchObject({ factoryCode: expect.any(Array) });
    }
    const first = (await send('post', 'defects', { ...input, factoryCode: 'FACTORY_1' }).expect(201)).body;
    const second = (await send('post', 'defects', { ...input, factoryCode: 'FACTORY_2' }).expect(201)).body;
    expect([first.factoryCode, second.factoryCode]).toEqual(['FACTORY_1', 'FACTORY_2']);
    const invalidUpdate = await send('put', `defects/${first.id}`, { expectedVersion: 1, factoryCode: null }).expect(400);
    expect(invalidUpdate.body.fields).toMatchObject({ factoryCode: expect.any(Array) });
    const legacy = await prisma.processDefect.create({ data: { organizationId, batchCode, description: '历史记录', createdById: userId, updatedById: userId } });
    const detail = await request(app.getHttpServer()).get(`/api/v1/process-quality/defects/${legacy.id}`).set('Cookie', cookie).expect(200);
    expect(detail.body.factoryCode).toBeNull();
    const filtersFor = (operator: string, value?: string) => JSON.stringify({ logic: 'ALL', items: [{ field: 'factoryCode', operator, value }] });
    for (const { operator, value, ids } of [
      { operator: 'EQ', value: 'FACTORY_1', ids: [first.id] },
      { operator: 'NE', value: 'FACTORY_1', ids: [second.id] },
      { operator: 'EMPTY', ids: [legacy.id] },
      { operator: 'NOT_EMPTY', ids: [first.id, second.id] },
    ]) {
      const filters = filtersFor(operator, value);
      const results = await list({ batchCode, filters }).expect(200);
      expect(results.body.total).toBe(ids.length);
      expect(results.body.items).toEqual(expect.arrayContaining(ids.map(id => expect.objectContaining({ id }))));
      expect(results.body.items).toHaveLength(ids.length);
      if (operator === 'EMPTY') expect(results.body.items[0].factoryCode).toBeNull();
      const page = await list({ batchCode, filters, pageSize: 1 }).expect(200);
      expect(page.body.total).toBe(ids.length);
      expect(page.body.items).toHaveLength(1);
    }
    await list({ batchCode, filters: filtersFor('EQ', 'FACTORY_3') }).expect(400);
  });

  it('rejects a write without matching CSRF and a cross-organization read', async () => {
    await request(app.getHttpServer()).post('/api/v1/process-quality/defects').set('Cookie', cookie).set('Idempotency-Key', randomUUID()).send({}).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/process-quality/defects?organizationId=${randomUUID()}`).set('Cookie', cookie).expect(403);
  });

  it('allows routine defect writes with an active session after recent authentication expires', async () => {
    await prisma.session.updateMany({ where: { userId }, data: { reauthenticatedAt: new Date(Date.now() - 600_000) } });
    try {
      await list({}).expect(200);
      await send('post', 'defect-types', { code: 'RUNOUT', name: '跳动' }).expect(201);
      const created = await send('post', 'defects', { defectTypeCode: 'RUNOUT', description: '跳动异常', defectQuantity: 2,
        occurredAt: '2026-09-24T02:00:00Z', productCode: 'ACTIVE-P', traceCode: 'ACTIVE-T', factoryCode: 'FACTORY_2' }).expect(201);
      await send('put', `defects/${created.body.id}`, { expectedVersion: 1, description: '复测跳动' }).expect(200);
      await send('put', `defects/${created.body.id}/archive`, { expectedVersion: 2, reason: '确认删除' }).expect(200);
    } finally {
      await prisma.session.updateMany({ where: { userId }, data: { reauthenticatedAt: new Date() } });
    }
  });

  it('exposes protected formal issue creation with validated source selection', async () => {
    await send('post', 'issues', { sources: [] }).expect(400);
  });

  it('creates and corrects a production fact through protected batch and summary routes', async () => {
    const batchCode = `HTTP-P-${randomUUID().slice(0, 8)}`;
    const created = await send('post', 'production-batches', {
      batchCode, workOrderCode: 'WO-01', operationCode: 'ASSEMBLY', productCode: 'P-01',
      periodStart: '2026-09-24T00:00:00Z', periodEnd: '2026-09-25T00:00:00Z',
      totalQuantity: 100, goodQuantity: 90, firstPassQuantity: 80,
    }).expect(201);
    expect(created.body).toMatchObject({ batchCode, sourceKind: 'MANUAL', yieldRate: 0.9, firstPassRate: 0.8 });
    const summary = await request(app.getHttpServer()).get('/api/v1/process-quality/production-batches/summary?periodStart=2026-09-24T00:00:00Z&periodEnd=2026-09-25T00:00:00Z').set('Cookie', cookie).expect(200);
    expect(summary.body.totalQuantity).toBeGreaterThanOrEqual(100);
    const corrected = await send('put', `production-batches/${created.body.id}/correct`, { expectedVersion: 1, goodQuantity: 95, firstPassQuantity: 85, reason: '复核' }).expect(200);
    expect(corrected.body.version).toBe(2);
    const detail = await request(app.getHttpServer()).get(`/api/v1/process-quality/production-batches/${created.body.id}`).set('Cookie', cookie).expect(200);
    expect(detail.body.revisions).toHaveLength(2);
  });
});
