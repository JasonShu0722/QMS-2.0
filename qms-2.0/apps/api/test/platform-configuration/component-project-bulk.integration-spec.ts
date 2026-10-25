import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { ComponentProjectBulkService } from '../../src/modules/platform-configuration/component-project-bulk.service.js';
import type { ComponentProjectBulkChangesDto, ComponentProjectBulkPreviewDto, ComponentProjectBulkPreviewResultDto } from '../../src/modules/platform-configuration/component-project-bulk.dto.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Component bulk tests require disposable loopback PostgreSQL, never preview 55440.');
}

describe('atomic component bulk configuration with real PostgreSQL / HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const csrf = randomUUID();
  const base = '/api/v1/admin/configuration/component-project-mappings';
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  async function fixture(codes = ['component-project:manage'], type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'N2 bulk isolated fixture', type } });
    const user = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: type } });
    const permissions = await Promise.all(codes.map((code) => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Bulk fixture role', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: role.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = (await app.get(SessionService).resolve(token))!;
    return { org, user, role, cookie: `qms_session=${token}; qms_csrf=${csrf}`, actor: { ...session.user, sessionId: session.id } };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function post(f: Fixture, action: 'bulk-preview' | 'bulk-apply', body: object, key = randomUUID(), organizationId?: string) {
    const call = request(app.getHttpServer()).post(`${base}/${action}`).set('Cookie', f.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
    return organizationId ? call.query({ organizationId }) : call;
  }
  async function project(f: Fixture) {
    const id = randomUUID();
    await prisma.$executeRaw`INSERT INTO component_project_records (id, organization_id, code, name, stage, created_by_user_id, updated_by_user_id)
      VALUES (${id}::uuid, ${f.org.id}::uuid, ${id}, 'Bulk project', 'NEW_PRODUCT', ${f.user.id}::uuid, ${f.user.id}::uuid)`;
    return id;
  }
  async function mapping(f: Fixture, projectId: string | null = null) {
    const id = randomUUID();
    await prisma.$executeRaw`INSERT INTO component_project_mappings (id, organization_id, component_code, component_name, project_record_id, product_category, product_subcategory, created_by_user_id, updated_by_user_id)
      VALUES (${id}::uuid, ${f.org.id}::uuid, ${id}, 'Bulk component', ${projectId}::uuid, 'Drive', 'Shaft', ${f.user.id}::uuid, ${f.user.id}::uuid)`;
    return id;
  }
  async function engineer(f: Fixture, startedAt = new Date(Date.now() - 60_000), endedAt: Date | null = null) {
    const user = await prisma.user.create({ data: { organizationId: f.org.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'unused' } });
    const department = await prisma.department.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Bulk engineering' } });
    const position = await prisma.position.create({ data: { organizationId: f.org.id, departmentId: department.id, code: randomUUID(), name: 'Actual assignment, not a name match' } });
    const assignment = await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: user.id, positionId: position.id, startedAt, endedAt } });
    return { user, department, position, assignment };
  }
  function body(ids: string[], changes: ComponentProjectBulkChangesDto): ComponentProjectBulkPreviewDto {
    return { selection: ids.map((id) => ({ id, expectedVersion: 1 })), changes };
  }
  async function preview(f: Fixture, input: ComponentProjectBulkPreviewDto): Promise<ComponentProjectBulkPreviewResultDto> {
    return (await post(f, 'bulk-preview', input).expect(200)).body;
  }
  async function apply(f: Fixture, input: ComponentProjectBulkPreviewDto, key = randomUUID()) {
    const p = await preview(f, input);
    return post(f, 'bulk-apply', { ...input, previewToken: p.previewToken }, key);
  }
  async function readMapping(id: string) {
    const [row] = await prisma.$queryRaw<{ id: string; version: number; project_record_id: string | null; product_category: string | null; product_subcategory: string | null; component_name: string | null; updated_by_user_id: string }[]>`SELECT * FROM component_project_mappings WHERE id = ${id}::uuid`;
    return row!;
  }
  async function readProject(id: string) {
    const [row] = await prisma.$queryRaw<{ id: string; version: number; stage: string; customer_engineer_assignment_id: string | null; project_engineer_assignment_id: string | null; updated_by_user_id: string }[]>`SELECT * FROM component_project_records WHERE id = ${id}::uuid`;
    return row!;
  }

  it('bounds selection, forbids empty changes/duplicate IDs/identity edits, and requires CSRF plus idempotency', async () => {
    const f = await fixture();
    const id = await mapping(f);
    for (const input of [body([], { productCategory: 'Body' }), body(Array.from({ length: 101 }, () => randomUUID()), { productCategory: 'Body' }), body([id, id], { productCategory: 'Body' }), body([id], {}), { ...body([id], {}), changes: { componentName: 'Forbidden' } }]) {
      await post(f, 'bulk-preview', input).expect(400);
    }
    const input = body([id], { productCategory: 'Body' });
    const p = await preview(f, input);
    const payload = { ...input, previewToken: p.previewToken };
    await request(app.getHttpServer()).post(`${base}/bulk-apply`).set('Cookie', f.cookie).set('Idempotency-Key', randomUUID()).send(payload).expect(403);
    await request(app.getHttpServer()).post(`${base}/bulk-apply`).set('Cookie', f.cookie).set('x-csrf-token', csrf).send(payload).expect(400);
    await post(f, 'bulk-apply', { ...payload, previewToken: 'a'.repeat(64) }).expect(409);
    expect((await readMapping(id)).version).toBe(1);
  });

  it('requires manage permission and INTERNAL active scope at HTTP and service boundaries without leaking foreign IDs', async () => {
    const f = await fixture();
    const other = await fixture();
    const reader = await fixture(['component-project:read']);
    const supplier = await fixture(['component-project:manage'], 'SUPPLIER');
    const id = await mapping(f);
    const input = body([id], { productCategory: 'Body' });
    await post(reader, 'bulk-preview', input).expect(403);
    await post(supplier, 'bulk-preview', input).expect(403);
    await post(f, 'bulk-preview', input, randomUUID(), other.org.id).expect(403);
    await post(other, 'bulk-preview', input).expect(404);
    await post(other, 'bulk-preview', body([await mapping(other)], { projectRecordId: await project(f) })).expect(404);
    await expect(app.get(ComponentProjectBulkService).preview(reader.actor, reader.org.id, input)).rejects.toMatchObject({ status: 403 });
    await prisma.userRole.create({ data: { organizationId: other.org.id, userId: f.user.id, roleId: other.role.id } });
    await prisma.organization.update({ where: { id: other.org.id }, data: { status: 'DISABLED' } });
    await post(f, 'bulk-preview', input, randomUUID(), other.org.id).expect(403);
  });

  it('previews without receipts/audits and updates two selected components through one shared project including an unselected member', async () => {
    const f = await fixture();
    const p = await project(f);
    const ids = await Promise.all([mapping(f, p), mapping(f, p), mapping(f, p)]);
    const c = await engineer(f);
    const e = await engineer(f);
    const input = body(ids.slice(0, 2), { stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: c.assignment.id, projectEngineerAssignmentId: e.assignment.id });
    const before = await prisma.auditEvent.count({ where: { organizationId: f.org.id } });
    const result = await preview(f, input);
    expect(result).toMatchObject({ selectedCount: 2, affectedMappingsCount: 3, affectedProjects: [{ id: p, version: 1, totalComponentCount: 3, selectedComponentCount: 2, otherComponentCount: 1 }] });
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id } })).toBe(before);
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id } })).toBe(0);
    const updated = await post(f, 'bulk-apply', { ...input, previewToken: result.previewToken }).expect(200);
    expect(updated.body).toMatchObject({ updatedMappingCount: 0, updatedProjectCount: 1, affectedComponentCount: 3 });
    expect(await readProject(p)).toMatchObject({ stage: 'MASS_PRODUCTION', version: 2, customer_engineer_assignment_id: c.assignment.id, project_engineer_assignment_id: e.assignment.id, updated_by_user_id: f.user.id });
    for (const id of ids) expect((await readMapping(id)).version).toBe(1);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: p, action: 'COMPONENT_PROJECT_UPDATED' } });
    expect(audit.metadata).toMatchObject({ resourceVersion: 2, previousResourceVersion: 1, componentProjectStage: 'MASS_PRODUCTION', previousComponentProjectStage: 'NEW_PRODUCT', customerEngineerAssignmentId: c.assignment.id, previousCustomerEngineerAssignmentId: null });
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, action: 'COMPONENT_PROJECT_BULK_UPDATED' } })).toBe(1);
  });

  it('reassigns only selected mappings and changes shared fields only on the final target project', async () => {
    const f = await fixture();
    const source = await project(f);
    const target = await project(f);
    const selected = await mapping(f, source);
    const sourceOther = await mapping(f, source);
    const targetOther = await mapping(f, target);
    const engineerChoice = await engineer(f);
    const input = body([selected], { projectRecordId: target, stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: engineerChoice.assignment.id, productCategory: 'Body' });
    expect(await preview(f, input)).toMatchObject({ affectedMappingsCount: 2, affectedProjects: [{ id: target, selectedComponentCount: 1, totalComponentCount: 2, otherComponentCount: 1 }] });
    expect((await apply(f, input)).body).toMatchObject({ updatedMappingCount: 1, updatedProjectCount: 1, affectedComponentCount: 2 });
    expect(await readProject(source)).toMatchObject({ version: 1, stage: 'NEW_PRODUCT', customer_engineer_assignment_id: null });
    expect(await readProject(target)).toMatchObject({ version: 2, stage: 'MASS_PRODUCTION', customer_engineer_assignment_id: engineerChoice.assignment.id });
    expect(await readMapping(selected)).toMatchObject({ project_record_id: target, product_category: 'Body', product_subcategory: 'Shaft', component_name: 'Bulk component', version: 2 });
    expect(await readMapping(sourceOther)).toMatchObject({ project_record_id: source, version: 1 });
    expect(await readMapping(targetOther)).toMatchObject({ project_record_id: target, version: 1 });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: selected, action: 'COMPONENT_PROJECT_MAPPING_UPDATED' } });
    expect(audit.metadata).toMatchObject({ projectRecordId: target, previousProjectRecordId: source, productCategory: 'Body', previousProductCategory: 'Drive', previousResourceVersion: 1, resourceVersion: 2 });
  });

  it.each(['retained', 'reassigned'] as const)('maintains a %s disabled project without activating it and exposes its status in preview', async (association) => {
    const f = await fixture();
    const disabled = await project(f);
    const source = association === 'reassigned' ? await project(f) : disabled;
    const selected = await mapping(f, source);
    const other = await mapping(f, disabled);
    await prisma.$executeRaw`UPDATE component_project_records SET status = 'DISABLED' WHERE id = ${disabled}::uuid`;
    const input = body([selected], { stage: 'MASS_PRODUCTION', ...(association === 'reassigned' ? { projectRecordId: disabled } : {}) });
    const planned = await preview(f, input);
    expect(planned).toMatchObject({ affectedProjects: [{ id: disabled, status: 'DISABLED', version: 1, selectedComponentCount: 1, totalComponentCount: 2, otherComponentCount: 1 }] });
    expect((await post(f, 'bulk-apply', { ...input, previewToken: planned.previewToken }).expect(200)).body).toMatchObject({ updatedMappingCount: association === 'reassigned' ? 1 : 0, updatedProjectCount: 1, affectedComponentCount: 2 });
    expect(await readProject(disabled)).toMatchObject({ stage: 'MASS_PRODUCTION', status: 'DISABLED', version: 2 });
    expect(await readMapping(selected)).toMatchObject({ project_record_id: disabled, status: 'ACTIVE' });
    expect(await readMapping(other)).toMatchObject({ project_record_id: disabled, version: 1 });
    if (source !== disabled) expect(await readProject(source)).toMatchObject({ stage: 'NEW_PRODUCT', status: 'ACTIVE', version: 1 });
  });

  it('preserves omitted values, clears only nullable fields, and does not increment versions for identical changes', async () => {
    const f = await fixture();
    const p = await project(f);
    const id = await mapping(f, p);
    const e = await engineer(f);
    await prisma.$executeRaw`UPDATE component_project_records SET customer_engineer_assignment_id = ${e.assignment.id}::uuid, project_engineer_assignment_id = ${e.assignment.id}::uuid WHERE id = ${p}::uuid`;
    expect((await apply(f, body([id], { customerEngineerAssignmentId: null, productSubcategory: null }))).body).toMatchObject({ updatedMappingCount: 1, updatedProjectCount: 1, affectedComponentCount: 1 });
    expect(await readProject(p)).toMatchObject({ stage: 'NEW_PRODUCT', customer_engineer_assignment_id: null, project_engineer_assignment_id: e.assignment.id, version: 2 });
    expect(await readMapping(id)).toMatchObject({ project_record_id: p, product_category: 'Drive', product_subcategory: null, version: 2 });
    const input = { selection: [{ id, expectedVersion: 2 }], changes: { productCategory: 'Drive' } };
    expect((await apply(f, input)).body).toMatchObject({ updatedMappingCount: 0, updatedProjectCount: 0, affectedComponentCount: 0 });
    expect((await readMapping(id)).version).toBe(2);
  });

  it('never defaults an unmapped component to a project or mass production', async () => {
    const f = await fixture();
    const id = await mapping(f);
    for (const changes of [{ stage: 'MASS_PRODUCTION' as const }, { projectEngineerAssignmentId: null }]) await post(f, 'bulk-preview', body([id], changes)).expect(409);
    expect((await apply(f, body([id], { productCategory: 'Body' }))).body.updatedMappingCount).toBe(1);
    expect(await readMapping(id)).toMatchObject({ project_record_id: null, version: 2 });
    const p = await project(f);
    const input = { selection: [{ id, expectedVersion: 2 }], changes: { projectRecordId: p, stage: 'MASS_PRODUCTION' as const } };
    expect((await apply(f, input)).body).toMatchObject({ updatedMappingCount: 1, updatedProjectCount: 1 });
  });

  it('previews the same actual impact count returned by mixed and unchanged batch submissions', async () => {
    const f = await fixture();
    const p = await project(f);
    const a = await mapping(f, p);
    const b = await mapping(f, p);
    await prisma.$executeRaw`UPDATE component_project_mappings SET product_category = 'Body' WHERE id = ${a}::uuid`;
    const input = body([a, b], { productCategory: 'Body' });
    const first = await preview(f, input);
    expect(first).toMatchObject({ selectedCount: 2, affectedMappingsCount: 1 });
    expect((await post(f, 'bulk-apply', { ...input, previewToken: first.previewToken }).expect(200)).body)
      .toMatchObject({ updatedMappingCount: 1, updatedProjectCount: 0, affectedComponentCount: 1 });
    expect(await readMapping(a)).toMatchObject({ version: 1 });
    expect(await readMapping(b)).toMatchObject({ version: 2 });
    const unchanged = { selection: [{ id: a, expectedVersion: 1 }, { id: b, expectedVersion: 2 }], changes: { productCategory: 'Body' } };
    const second = await preview(f, unchanged);
    expect(second).toMatchObject({ selectedCount: 2, affectedMappingsCount: 0 });
    expect((await post(f, 'bulk-apply', { ...unchanged, previewToken: second.previewToken }).expect(200)).body)
      .toMatchObject({ updatedMappingCount: 0, updatedProjectCount: 0, affectedComponentCount: 0 });
  });

  it.each(['selection', 'project', 'member-version', 'member-added', 'member-moved'] as const)('rejects a stale %s snapshot with 409 and leaves the whole batch unchanged', async (change) => {
    const f = await fixture();
    const p = await project(f);
    const id = await mapping(f, p);
    const member = await mapping(f, p);
    const input = body([id], { stage: 'MASS_PRODUCTION', productCategory: 'Body' });
    const planned = await preview(f, input);
    if (change === 'selection') await prisma.$executeRaw`UPDATE component_project_mappings SET version = version + 1 WHERE id = ${id}::uuid`;
    if (change === 'project') await prisma.$executeRaw`UPDATE component_project_records SET version = version + 1 WHERE id = ${p}::uuid`;
    if (change === 'member-version') await prisma.$executeRaw`UPDATE component_project_mappings SET version = version + 1 WHERE id = ${member}::uuid`;
    if (change === 'member-added') await mapping(f, p);
    if (change === 'member-moved') await prisma.$executeRaw`UPDATE component_project_mappings SET project_record_id = NULL, version = version + 1 WHERE id = ${member}::uuid`;
    const rejected = await post(f, 'bulk-apply', { ...input, previewToken: planned.previewToken }).expect(409);
    expect(rejected.body.code).toBe('CONCURRENCY_CONFLICT');
    expect((await readMapping(id)).product_category).toBe('Drive');
    expect((await readProject(p)).stage).toBe('NEW_PRODUCT');
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, outcome: 'SUCCESS' } })).toBe(0);
  });

  it('replays one receipt without reapplying/auditing, rejects a changed payload and rechecks revoked manage access', async () => {
    const f = await fixture();
    const id = await mapping(f);
    const input = body([id], { productCategory: 'Body' });
    const planned = await preview(f, input);
    const payload = { ...input, previewToken: planned.previewToken };
    const key = randomUUID();
    const first = await post(f, 'bulk-apply', payload, key).expect(200);
    const events = await prisma.auditEvent.count({ where: { organizationId: f.org.id } });
    expect((await post(f, 'bulk-apply', payload, key).expect(200)).body).toEqual(first.body);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id } })).toBe(events);
    expect((await readMapping(id)).version).toBe(2);
    const changed = await post(f, 'bulk-apply', { ...payload, changes: { productCategory: 'Changed' } }, key).expect(409);
    expect(changed.body.code).toBe('IDEMPOTENCY_REPLAY');
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
    await post(f, 'bulk-apply', payload, key).expect(403);
    expect((await readMapping(id)).version).toBe(2);
  });

  it('rechecks target lifecycle before replay instead of trusting a previous preview or receipt', async () => {
    const f = await fixture();
    const target = await fixture();
    await prisma.userRole.create({ data: { organizationId: target.org.id, userId: f.user.id, roleId: target.role.id } });
    const id = await mapping(target);
    const input = body([id], { productCategory: 'Body' });
    const planned = (await post(f, 'bulk-preview', input, randomUUID(), target.org.id).expect(200)).body;
    const payload = { ...input, previewToken: planned.previewToken };
    const key = randomUUID();
    await post(f, 'bulk-apply', payload, key, target.org.id).expect(200);
    expect((await readMapping(id)).updated_by_user_id).toBe(f.user.id);
    await prisma.organization.update({ where: { id: target.org.id }, data: { status: 'DISABLED' } });
    await expect(app.get(ComponentProjectBulkService).apply(f.actor, target.org.id, payload, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
  });

  it('allows only one concurrent shared-project CAS and rolls back the losing batch mapping updates', async () => {
    const f = await fixture();
    const p = await project(f);
    const ids = await Promise.all([mapping(f, p), mapping(f, p)]);
    const inputs = ids.map((id) => body([id], { stage: 'MASS_PRODUCTION', productCategory: 'Body' }));
    const planned = await Promise.all(inputs.map((input) => preview(f, input)));
    const responses = await Promise.all(inputs.map((input, index) => post(f, 'bulk-apply', { ...input, previewToken: planned[index]!.previewToken })));
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect((await readProject(p)).version).toBe(2);
    expect((await Promise.all(ids.map(readMapping))).map(({ version }) => version).sort()).toEqual([1, 2]);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, action: 'COMPONENT_PROJECT_UPDATED' } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, action: 'COMPONENT_PROJECT_MAPPING_UPDATED' } })).toBe(1);
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id } })).toBe(1);
  });

  it('rolls back mapping writes and their audit when the real project version constraint fails later in the same transaction', async () => {
    const f = await fixture();
    const p = await project(f);
    const ids = await Promise.all([mapping(f, p), mapping(f, p)]);
    await prisma.$executeRaw`UPDATE component_project_records SET version = 2147483647 WHERE id = ${p}::uuid`;
    const input = body(ids, { stage: 'MASS_PRODUCTION', productCategory: 'Body' });
    const planned = await preview(f, input);
    await post(f, 'bulk-apply', { ...input, previewToken: planned.previewToken }).expect(409);
    for (const id of ids) expect(await readMapping(id)).toMatchObject({ product_category: 'Drive', version: 1 });
    expect(await readProject(p)).toMatchObject({ stage: 'NEW_PRODUCT', version: 2147483647 });
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, outcome: 'SUCCESS' } })).toBe(0);
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id } })).toBe(0);
  });

  it.each(['foreign', 'ended', 'future', 'missing'] as const)('rejects a %s concrete engineer assignment at both server entry points', async (state) => {
    const f = await fixture();
    const p = await project(f);
    const id = await mapping(f, p);
    const assignmentId = state === 'missing' ? randomUUID() : (await engineer(state === 'foreign' ? await fixture() : f,
      new Date(Date.now() + (state === 'future' ? 86_400_000 : -120_000)), state === 'ended' ? new Date(Date.now() - 1_000) : null)).assignment.id;
    const input = body([id], { customerEngineerAssignmentId: assignmentId });
    await post(f, 'bulk-preview', input).expect(409);
    await post(f, 'bulk-apply', { ...input, previewToken: 'a'.repeat(64) }).expect(409);
    expect((await readProject(p)).version).toBe(1);
    expect((await readMapping(id)).version).toBe(1);
  });

  it.each(['user', 'position', 'department', 'appointment-ended'] as const)('revalidates an engineer after %s changes between preview and apply', async (disabled) => {
    const f = await fixture();
    const p = await project(f);
    const id = await mapping(f, p);
    const e = await engineer(f);
    const input = body([id], { projectEngineerAssignmentId: e.assignment.id });
    const planned = await preview(f, input);
    if (disabled === 'user') await prisma.user.update({ where: { id: e.user.id }, data: { status: 'DISABLED' } });
    if (disabled === 'position') await prisma.position.update({ where: { id: e.position.id }, data: { status: 'DISABLED' } });
    if (disabled === 'department') await prisma.department.update({ where: { id: e.department.id }, data: { status: 'DISABLED' } });
    if (disabled === 'appointment-ended') await prisma.userPosition.update({ where: { id: e.assignment.id }, data: { endedAt: new Date(Date.now() - 1_000) } });
    await post(f, 'bulk-preview', input).expect(409);
    await post(f, 'bulk-apply', { ...input, previewToken: planned.previewToken }).expect(409);
    expect((await readProject(p)).version).toBe(1);
    expect((await readMapping(id)).version).toBe(1);
  });

  it('keeps database foreign keys enabled and rejects a forged foreign assignment regardless of fingerprint knowledge', async () => {
    const f = await fixture();
    const other = await fixture();
    const p = await project(f);
    const id = await mapping(f, p);
    const e = await engineer(other);
    await expect(prisma.$executeRaw`UPDATE component_project_records SET customer_engineer_assignment_id = ${e.assignment.id}::uuid WHERE id = ${p}::uuid`).rejects.toBeDefined();
    const input = body([id], { customerEngineerAssignmentId: e.assignment.id });
    await post(f, 'bulk-apply', { ...input, previewToken: 'a'.repeat(64) }).expect(409);
    expect((await readProject(p)).customer_engineer_assignment_id).toBeNull();
  });
});
