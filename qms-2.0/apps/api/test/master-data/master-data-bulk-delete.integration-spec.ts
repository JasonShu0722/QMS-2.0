import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) || connection.port === '55440') throw new Error('Bulk delete tests require disposable loopback PostgreSQL, never preview 55440.');
jest.setTimeout(120_000);

describe('master data selected deletion on real PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const csrf = randomUUID();
  const domains = [
    { name: 'supplier', path: '/api/v1/supplier-quality/profiles', body: () => ({ businessCode: randomUUID(), displayName: '供应商' }) },
    { name: 'customer', path: '/api/v1/customer-quality/customers', body: () => ({ code: randomUUID(), name: '客户' }) },
    { name: 'material', path: '/api/v1/material-masters', body: () => ({ materialCode: randomUUID(), materialName: '物料' }) },
    { name: 'mapping', path: '/api/v1/admin/configuration/component-project-mappings', body: () => ({ componentCode: randomUUID(), componentName: '组件' }) },
  ];

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app?.close(); });

  async function fixture(administrator = true) {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: '批量删除测试', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    if (administrator) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
      const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: '平台管理员', permissions: { create: { permissionId: permission.id } } } });
      await prisma.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: role.id } });
    }
    const token = await app.get(SessionService).create(user.id, prisma, { reauthenticated: true, mfaVerified: true });
    return { org, user, cookie: `qms_session=${token}; qms_csrf=${csrf}` };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function post(f: Fixture, path: string, body: object, key = randomUUID()) {
    return request(app.getHttpServer()).post(path).set('Cookie', f.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }
  async function create(f: Fixture, domain: typeof domains[number]) {
    if (domain.name === 'mapping') {
      const body = domain.body();
      const result = await post(f, `${domain.path}/import`, { rows: [{ rowNumber: 1, ...body }] }).expect(201);
      expect(result.body.created).toBe(1);
      const list = await request(app.getHttpServer()).get(domain.path).query({ search: body.componentCode }).set('Cookie', f.cookie).expect(200);
      return list.body.items[0] as { id: string; version: number; componentCode: string };
    }
    return (await post(f, domain.path, domain.body()).expect(201)).body as { id: string; version: number };
  }

  for (const domain of domains) {
    it(`${domain.name}: deletes selected manual/import records independently, retains conflicts and safely replays unknown outcomes`, async () => {
      const f = await fixture();
      const other = await fixture();
      const first = await create(f, domain);
      const second = await create(f, domain);
      const foreign = await create(other, domain);
      const missing = randomUUID();
      const key = randomUUID();
      const body = { records: [{ id: first.id, expectedVersion: 1 }, { id: second.id, expectedVersion: 99 }, { id: foreign.id, expectedVersion: 1 }, { id: missing, expectedVersion: 1 }] };
      const result = await post(f, `${domain.path}/bulk-delete`, body, key).expect(201);
      expect(result.body).toEqual({ items: [
        { id: first.id, status: 'DELETED' }, { id: second.id, status: 'CONFLICT' },
        { id: foreign.id, status: 'NOT_FOUND' }, { id: missing, status: 'NOT_FOUND' },
      ], deleted: 1, referenced: 0, conflicted: 1, notFound: 2 });
      expect((await post(f, `${domain.path}/bulk-delete`, body, key).expect(201)).body).toEqual(result.body);
      await post(f, `${domain.path}/bulk-delete`, { records: [{ id: second.id, expectedVersion: 1 }] }, key).expect(409);
      expect((await post(other, `${domain.path}/bulk-delete`, { records: [{ id: foreign.id, expectedVersion: 1 }] }).expect(201)).body.deleted).toBe(1);
      expect((await post(f, `${domain.path}/bulk-delete`, { records: [{ id: second.id, expectedVersion: 1 }] }).expect(201)).body.deleted).toBe(1);
    });

    it(`${domain.name}: enforces permissions, scope, CSRF, recent authentication and bounded versioned selection`, async () => {
      const f = await fixture();
      const ordinary = await fixture(false);
      const record = await create(f, domain);
      const path = `${domain.path}/bulk-delete`;
      const records = [{ id: record.id, expectedVersion: 1 }];
      await post(ordinary, path, { records }).expect(403);
      await post(ordinary, path, { organizationId: f.org.id, records }).expect(403);
      for (const invalid of [[], [...records, ...records], [{ id: record.id, expectedVersion: 0 }], [{ id: 'invalid', expectedVersion: 1 }], [{ id: record.id, expectedVersion: 1, force: true }], Array.from({ length: 1001 }, () => ({ id: randomUUID(), expectedVersion: 1 }))]) await post(f, path, { records: invalid }).expect(400);
      await request(app.getHttpServer()).post(path).set('Cookie', f.cookie).set('Idempotency-Key', randomUUID()).send({ records }).expect(403);
      await request(app.getHttpServer()).post(path).set('Cookie', f.cookie).set('x-csrf-token', csrf).send({ records }).expect(400);
      await prisma.session.updateMany({ where: { userId: f.user.id }, data: { reauthenticatedAt: new Date(Date.now() - 3_600_000) } });
      await post(f, path, { records }).expect(403);
    });
  }

  it('retains supplier business references and customer child relations without rolling back unrelated records', async () => {
    const f = await fixture();
    const supplier = await create(f, domains[0]!);
    const freeSupplier = await create(f, domains[0]!);
    await prisma.$executeRaw`INSERT INTO supplier_quality_targets(id,owner_organization_id,profile_id,period_type,target_year,title,metrics,created_by_id) VALUES(${randomUUID()}::uuid,${f.org.id}::uuid,${supplier.id}::uuid,'ANNUAL',2026,'质量目标','{}'::jsonb,${f.user.id}::uuid)`;
    const supplierResult = await post(f, `${domains[0]!.path}/bulk-delete`, { records: [{ id: supplier.id, expectedVersion: 1 }, { id: freeSupplier.id, expectedVersion: 1 }] }).expect(201);
    expect(supplierResult.body).toMatchObject({ deleted: 1, referenced: 1, items: [{ id: supplier.id, status: 'REFERENCED' }, { id: freeSupplier.id, status: 'DELETED' }] });
    const customer = await create(f, domains[1]!);
    const freeCustomer = await create(f, domains[1]!);
    const relation = await post(f, `${domains[1]!.path}/${customer.id}/relations`, { relationType: 'PRODUCT', relatedCode: 'P', relatedName: '产品' }).expect(201);
    const customerResult = await post(f, `${domains[1]!.path}/bulk-delete`, { records: [{ id: customer.id, expectedVersion: 1 }, { id: freeCustomer.id, expectedVersion: 1 }] }).expect(201);
    expect(customerResult.body).toMatchObject({ deleted: 1, referenced: 1 });
    expect(await prisma.$queryRaw`SELECT id FROM customer_quality_customer_relations WHERE id=${relation.body.id}::uuid`).toHaveLength(1);
  });

  it('keeps shared project records and ingestion history after deleting an unreferenced mapping', async () => {
    const f = await fixture();
    const mapping = await create(f, domains[3]!);
    const project = await post(f, '/api/v1/admin/configuration/component-project-records', { code: randomUUID(), name: '共享项目', stage: 'NEW_PRODUCT' }).expect(201);
    await request(app.getHttpServer()).patch(`${domains[3]!.path}/${mapping.id}`).set('Cookie', f.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1, projectRecordId: project.body.id, productCategory: '产品' }).expect(200);
    const endpointId = randomUUID();
    await prisma.$executeRaw`INSERT INTO integration_ingestion_target_versions(organization_id,target,target_id,endpoint_id,receipt_received_at,target_version) VALUES(${f.org.id}::uuid,'COMPONENT',${mapping.id}::uuid,${endpointId}::uuid,CURRENT_TIMESTAMP,2)`;
    const result = await post(f, `${domains[3]!.path}/bulk-delete`, { records: [{ id: mapping.id, expectedVersion: 2 }] }).expect(201);
    expect(result.body.deleted).toBe(1);
    expect(await prisma.$queryRaw`SELECT id FROM component_project_records WHERE id=${project.body.id}::uuid`).toHaveLength(1);
    expect(await prisma.$queryRaw`SELECT target_id FROM integration_ingestion_target_versions WHERE target_id=${mapping.id}::uuid`).toHaveLength(1);
  });

  it('protects mappings used by dynamic process lookup and preserves independent historical material codes', async () => {
    const f = await fixture();
    const mapping = await create(f, domains[3]!) as { id: string; version: number; componentCode: string };
    const freeMapping = await create(f, domains[3]!);
    const materialCode = randomUUID();
    const material = await post(f, domains[2]!.path, { materialCode, materialName: '历史独立编码' }).expect(201);
    const defectId = randomUUID();
    await prisma.$executeRaw`INSERT INTO process_defect_types(id,organization_id,code,name,created_by_id,updated_at) VALUES(${randomUUID()}::uuid,${f.org.id}::uuid,'BULK-DELETE','缺陷类型',${f.user.id}::uuid,CURRENT_TIMESTAMP)`;
    await prisma.$executeRaw`INSERT INTO process_defects(id,organization_id,defect_type_code,description,defect_quantity,occurred_at,product_code,material_code,responsibility_category,created_by_id,updated_by_id,updated_at) VALUES(${defectId}::uuid,${f.org.id}::uuid,'BULK-DELETE','实际业务引用',1,CURRENT_TIMESTAMP,${mapping.componentCode},${materialCode},'MATERIAL',${f.user.id}::uuid,${f.user.id}::uuid,CURRENT_TIMESTAMP)`;
    const mappings = await post(f, `${domains[3]!.path}/bulk-delete`, { records: [{ id: mapping.id, expectedVersion: 1 }, { id: freeMapping.id, expectedVersion: 1 }] }).expect(201);
    expect(mappings.body).toMatchObject({ deleted: 1, referenced: 1, items: [{ id: mapping.id, status: 'REFERENCED' }, { id: freeMapping.id, status: 'DELETED' }] });
    expect((await post(f, `${domains[2]!.path}/bulk-delete`, { records: [{ id: material.body.id, expectedVersion: 1 }] }).expect(201)).body.deleted).toBe(1);
    expect(await prisma.$queryRaw`SELECT material_code FROM process_defects WHERE id=${defectId}::uuid`).toEqual([{ material_code: materialCode }]);
  });

  it('serializes identical concurrent batch retries and records each successful deletion once', async () => {
    const f = await fixture();
    const material = await create(f, domains[2]!);
    const key = randomUUID();
    const body = { records: [{ id: material.id, expectedVersion: 1 }] };
    const outcomes = await Promise.all([post(f, `${domains[2]!.path}/bulk-delete`, body, key), post(f, `${domains[2]!.path}/bulk-delete`, body, key)]);
    expect(outcomes.map(result => result.status)).toEqual([201, 201]);
    expect(outcomes[0]!.body).toEqual(outcomes[1]!.body);
    expect(outcomes[0]!.body.deleted).toBe(1);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, resourceId: material.id, action: 'MATERIAL_MASTER_DELETED' } })).toBe(1);
    await prisma.userRole.deleteMany({ where: { organizationId: f.org.id, userId: f.user.id } });
    await post(f, `${domains[2]!.path}/bulk-delete`, body, key).expect(403);
  });

  it('accepts the full 1000 selected record limit as one replayable command', async () => {
    const f = await fixture();
    const records = Array.from({ length: 1000 }, () => ({ id: randomUUID(), expectedVersion: 1 }));
    await prisma.$executeRaw`INSERT INTO material_masters(id,organization_id,material_code,material_name,created_by_id,updated_by_id,updated_at) SELECT id,${f.org.id}::uuid,id::text,'批量物料',${f.user.id}::uuid,${f.user.id}::uuid,CURRENT_TIMESTAMP FROM unnest(${records.map(record => record.id)}::uuid[]) AS id`;
    const key = randomUUID();
    const result = await post(f, `${domains[2]!.path}/bulk-delete`, { records }, key).expect(201);
    expect(result.body.deleted).toBe(1000);
    expect(result.body.items).toHaveLength(1000);
    expect((await post(f, `${domains[2]!.path}/bulk-delete`, { records }, key).expect(201)).body).toEqual(result.body);
  });

  it('retains supplier accounts and their collaboration profile', async () => {
    const f = await fixture();
    const supplier = await prisma.organization.create({ data: { code: randomUUID(), name: '供应商边界', type: 'SUPPLIER' } });
    const user = await prisma.user.create({ data: { organizationId: supplier.id, username: randomUUID(), passwordHash: 'unused', accountType: 'SUPPLIER' } });
    const profile = await create(f, domains[0]!);
    await prisma.supplierBusinessProfile.update({ where: { id: profile.id }, data: { supplierOrganizationId: supplier.id } });
    expect((await post(f, `${domains[0]!.path}/bulk-delete`, { records: [{ id: profile.id, expectedVersion: 1 }] }).expect(201)).body).toMatchObject({ deleted: 0, referenced: 1 });
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  it('protects a historical mapping ID independently of the current component code', async () => {
    const f = await fixture();
    const mapping = await create(f, domains[3]!);
    const defectId = randomUUID();
    const projectId = randomUUID();
    const snapshot = JSON.stringify({ inclusion: { mappingId: mapping.id, mappingVersion: 1 } });
    await prisma.$executeRaw`INSERT INTO process_defect_types(id,organization_id,code,name,created_by_id,updated_at) VALUES(${randomUUID()}::uuid,${f.org.id}::uuid,'HISTORY-REF','缺陷类型',${f.user.id}::uuid,CURRENT_TIMESTAMP)`;
    await prisma.$executeRaw`INSERT INTO process_defects(id,organization_id,defect_type_code,description,defect_quantity,occurred_at,product_code,responsibility_category,created_by_id,updated_by_id,updated_at) VALUES(${defectId}::uuid,${f.org.id}::uuid,'HISTORY-REF','历史ID引用',1,CURRENT_TIMESTAMP,'INDEPENDENT-CODE','DESIGN',${f.user.id}::uuid,${f.user.id}::uuid,CURRENT_TIMESTAMP)`;
    await prisma.$executeRaw`INSERT INTO new_product_projects(id,organization_id,code,name,product_code,created_by_id) VALUES(${projectId}::uuid,${f.org.id}::uuid,${randomUUID()},'新产品','INDEPENDENT-CODE',${f.user.id}::uuid)`;
    await prisma.$executeRaw`INSERT INTO new_product_defect_selections(id,organization_id,project_id,defect_id,source_version,source_snapshot,selected_by_id) VALUES(${randomUUID()}::uuid,${f.org.id}::uuid,${projectId}::uuid,${defectId}::uuid,1,${snapshot}::jsonb,${f.user.id}::uuid)`;
    expect((await post(f, `${domains[3]!.path}/bulk-delete`, { records: [{ id: mapping.id, expectedVersion: 1 }] }).expect(201)).body).toMatchObject({ deleted: 0, referenced: 1 });
  });

  it('serializes competing deletion commands without duplicate effects', async () => {
    const f = await fixture();
    const material = await create(f, domains[2]!);
    const body = { records: [{ id: material.id, expectedVersion: 1 }] };
    const results = await Promise.all([post(f, `${domains[2]!.path}/bulk-delete`, body), post(f, `${domains[2]!.path}/bulk-delete`, body)]);
    expect(results.map(result => result.status)).toEqual([201, 201]);
    expect(results.map(result => result.body.items[0].status).sort()).toEqual(['DELETED', 'NOT_FOUND']);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, resourceId: material.id, action: 'MATERIAL_MASTER_DELETED' } })).toBe(1);
  });

  it('waits for a real domain lookup then protects its newly committed mapping reference', async () => {
    const f = await fixture();
    const mapping = await create(f, domains[3]!) as { id: string; version: number; componentCode: string };
    await prisma.$executeRaw`INSERT INTO process_defect_types(id,organization_id,code,name,created_by_id,updated_at) VALUES(${randomUUID()}::uuid,${f.org.id}::uuid,'DELETE-RACE','缺陷类型',${f.user.id}::uuid,CURRENT_TIMESTAMP)`;
    let ready!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reference = prisma.$transaction(async transaction => {
      await app.get(ComponentProjectService).resolveForDomain(transaction, f.org.id, mapping.componentCode);
      await transaction.$executeRaw`INSERT INTO process_defects(id,organization_id,defect_type_code,description,defect_quantity,occurred_at,product_code,responsibility_category,created_by_id,updated_by_id,updated_at) VALUES(${randomUUID()}::uuid,${f.org.id}::uuid,'DELETE-RACE','并发引用',1,CURRENT_TIMESTAMP,${mapping.componentCode},'DESIGN',${f.user.id}::uuid,${f.user.id}::uuid,CURRENT_TIMESTAMP)`;
      ready();
      await gate;
    });
    await started;
    const deletion = post(f, `${domains[3]!.path}/bulk-delete`, { records: [{ id: mapping.id, expectedVersion: 1 }] }).then(result => result);
    let blocked = false;
    try {
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        const [row] = await prisma.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event_type = 'Lock' AND query LIKE '%FROM component_project_mappings%' AND query LIKE '%FOR UPDATE%') AS blocked`;
        blocked = row!.blocked;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
      }
    } finally {
      release();
      await reference;
    }
    const result = await deletion;
    expect(blocked).toBe(true);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ referenced: 1, deleted: 0 });
  });

  it('supports the supplier and component page options up to 1000 without widening project or problem lists', async () => {
    const f = await fixture();
    for (const domain of [domains[0]!, domains[3]!]) {
      const record = await create(f, domain);
      const page = await request(app.getHttpServer()).get(domain.path).query({ pageSize: 1000 }).set('Cookie', f.cookie).expect(200);
      expect(page.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: record.id })]));
      await request(app.getHttpServer()).get(domain.path).query({ pageSize: 1001 }).set('Cookie', f.cookie).expect(400);
    }
    await request(app.getHttpServer()).get('/api/v1/admin/configuration/component-project-records').query({ pageSize: 101 }).set('Cookie', f.cookie).expect(400);
  });
});
