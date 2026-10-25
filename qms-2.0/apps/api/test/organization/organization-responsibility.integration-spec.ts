import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import type { AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Responsibilities require disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(120_000);

describe('organization management responsibilities PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: OrganizationResponsibilityService;
  let org: string;
  let otherOrg: string;
  let department: string;
  let section: string;
  let secondSection: string;
  let managerPosition: string;
  let ministerPosition: string;
  let managerAssignment: string;
  let ministerA: string;
  let ministerB: string;
  let dualUser: string;
  let actor: AdminActor;
  let cookie: string;
  const csrf = randomUUID();
  const start = new Date('2026-01-01T00:00:00.000Z');
  const at = new Date('2026-10-25T00:00:00.000Z');
  const end = new Date('2027-01-01T00:00:00.000Z');
  const send = (method: 'post' | 'patch', suffix: string, body: object, key = randomUUID(), targetOrg = org) => request(app.getHttpServer())[method](`/api/v1/organizations/${targetOrg}/${suffix}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  const get = (suffix: string, targetOrg = org) => request(app.getHttpServer()).get(`/api/v1/organizations/${targetOrg}/${suffix}`).set('Cookie', cookie);
  const createBinding = (responsibility: 'SECTION_MANAGER' | 'MINISTER', departmentId = responsibility === 'MINISTER' ? department : section, positionId = responsibility === 'MINISTER' ? ministerPosition : managerPosition) => service.createManagementBinding(actor, org, { departmentId, responsibility, positionId }, randomUUID(), randomUUID());
  const createScope = (sectionDepartmentId = section, ministerAssignmentId = ministerA, dates: { validFrom?: string; validTo?: string | null } = {}) => service.createMinisterScope(actor, org, { departmentId: department, sectionDepartmentId, ministerAssignmentId, ...dates }, randomUUID(), randomUUID());
  const resolve = (time = at, sectionId = section) => prisma.$transaction((tx) => service.resolveManagementResponsibilities(tx, org, sectionId, time));
  const user = (organizationId = org, accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') => prisma.user.create({ data: { organizationId, accountType, username: randomUUID(), passwordHash: 'unused' } });

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(OrganizationResponsibilityService);
  });

  beforeEach(async () => {
    org = (await prisma.organization.create({ data: { code: randomUUID(), name: 'Responsibility fixture', type: 'INTERNAL' } })).id;
    otherOrg = (await prisma.organization.create({ data: { code: randomUUID(), name: 'Foreign fixture', type: 'INTERNAL' } })).id;
    department = (await prisma.department.create({ data: { organizationId: org, code: randomUUID(), name: 'Department' } })).id;
    section = (await prisma.department.create({ data: { organizationId: org, parentId: department, code: randomUUID(), name: 'Section A' } })).id;
    secondSection = (await prisma.department.create({ data: { organizationId: org, parentId: department, code: randomUUID(), name: 'Section B' } })).id;
    managerPosition = (await prisma.position.create({ data: { organizationId: org, departmentId: section, code: randomUUID(), name: 'Arbitrary manager display name' } })).id;
    ministerPosition = (await prisma.position.create({ data: { organizationId: org, departmentId: department, code: randomUUID(), name: 'Arbitrary minister display name' } })).id;
    dualUser = (await user()).id;
    managerAssignment = (await prisma.userPosition.create({ data: { organizationId: org, userId: dualUser, positionId: managerPosition, startedAt: start } })).id;
    ministerA = (await prisma.userPosition.create({ data: { organizationId: org, userId: dualUser, positionId: ministerPosition, startedAt: start } })).id;
    ministerB = (await prisma.userPosition.create({ data: { organizationId: org, userId: (await user()).id, positionId: ministerPosition, startedAt: start } })).id;
    const governor = await user();
    const permissions = await Promise.all(['organization:structure:read', 'organization:structure:manage'].map((code) => prisma.permission.findUniqueOrThrow({ where: { code } })));
    const role = await prisma.role.create({ data: { organizationId: org, code: randomUUID(), name: 'Fixture governor', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { userId: governor.id, organizationId: org, roleId: role.id } });
    const token = await app.get(SessionService).create(governor.id, prisma, { mfaVerified: true, reauthenticated: true });
    actor = { id: governor.id, organizationId: org, accountType: 'INTERNAL', sessionId: (await app.get(SessionService).resolve(token))!.id };
    cookie = `qms_session=${token}; qms_csrf=${csrf}`;
  });

  afterAll(async () => { await app?.close(); });

  it('returns missing issues without administrator fallback or preventing a caller from saving a draft', async () => {
    expect(await resolve()).toMatchObject({ responsibilities: [], issues: [
      { responsibility: 'SECTION_MANAGER', code: 'BINDING_MISSING' },
      { responsibility: 'MINISTER', code: 'SCOPE_MISSING' },
    ] });
  });

  it('keeps two ministers on one department position separate and preserves the same user in both responsibilities', async () => {
    const manager = await createBinding('SECTION_MANAGER');
    const minister = await createBinding('MINISTER');
    const first = await createScope(section, ministerA, { validFrom: start.toISOString(), validTo: end.toISOString() });
    const second = await createScope(secondSection, ministerB, { validFrom: start.toISOString(), validTo: end.toISOString() });
    const result = await resolve();
    expect(result.issues).toEqual([]);
    expect(result.responsibilities).toHaveLength(2);
    expect(result.responsibilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ responsibility: 'SECTION_MANAGER', userId: dualUser, assignmentId: managerAssignment, bindingId: manager.id, bindingVersion: 1, scopeId: null, scopeVersion: null, positionId: managerPosition, positionVersion: 1, organizationVersion: 1, departmentVersion: 1, sectionDepartmentVersion: 1 }),
      expect.objectContaining({ responsibility: 'MINISTER', userId: dualUser, assignmentId: ministerA, bindingId: minister.id, bindingVersion: 1, scopeId: first.id, scopeVersion: 1, positionId: ministerPosition }),
    ]));
    expect((await resolve(at, secondSection)).responsibilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ responsibility: 'MINISTER', assignmentId: ministerB, scopeId: second.id }),
    ]));
  });

  it('rejects bindings to another department or organization and scopes to self, siblings or a different appointment position', async () => {
    await expect(createBinding('SECTION_MANAGER', section, ministerPosition)).rejects.toMatchObject({ status: 409 });
    const foreignDept = await prisma.department.create({ data: { organizationId: otherOrg, code: randomUUID(), name: 'Foreign' } });
    await expect(createBinding('SECTION_MANAGER', foreignDept.id, managerPosition)).rejects.toMatchObject({ status: 409 });
    await createBinding('MINISTER');
    await expect(createScope(department)).rejects.toMatchObject({ status: 409 });
    await expect(createScope(foreignDept.id)).rejects.toMatchObject({ status: 409 });
    const sibling = await prisma.department.create({ data: { organizationId: org, code: randomUUID(), name: 'Another root' } });
    await expect(createScope(sibling.id)).rejects.toMatchObject({ status: 409 });
    await expect(createScope(section, managerAssignment)).rejects.toMatchObject({ status: 409 });
    const unrelated = await prisma.position.create({ data: { organizationId: org, departmentId: department, code: randomUUID(), name: 'Not the bound position' } });
    const assignment = await prisma.userPosition.create({ data: { organizationId: org, userId: (await user()).id, positionId: unrelated.id, startedAt: start } });
    await expect(createScope(section, assignment.id)).rejects.toMatchObject({ status: 409 });
  });

  it('reports missing and ambiguous effective manager appointments instead of choosing by userId or display name', async () => {
    await createBinding('SECTION_MANAGER');
    await prisma.userPosition.update({ where: { id: managerAssignment }, data: { endedAt: at } });
    expect((await resolve()).issues).toContainEqual({ responsibility: 'SECTION_MANAGER', code: 'ASSIGNMENT_MISSING' });
    await prisma.userPosition.update({ where: { id: managerAssignment }, data: { endedAt: null } });
    const duplicate = await prisma.userPosition.create({ data: { organizationId: org, userId: dualUser, positionId: managerPosition, startedAt: start, endedAt: end } });
    expect((await resolve()).issues).toContainEqual({ responsibility: 'SECTION_MANAGER', code: 'ASSIGNMENT_AMBIGUOUS' });
    await prisma.userPosition.update({ where: { id: duplicate.id }, data: { endedAt: at } });
    expect((await resolve()).responsibilities).toEqual(expect.arrayContaining([expect.objectContaining({ assignmentId: managerAssignment })]));
  });

  it.each(['user', 'position', 'department', 'organization', 'supplier'] as const)('does not resolve an inactive or non-internal %s', async (target) => {
    await createBinding('SECTION_MANAGER');
    if (target === 'user') await prisma.user.update({ where: { id: dualUser }, data: { status: 'DISABLED' } });
    if (target === 'supplier') await prisma.user.update({ where: { id: dualUser }, data: { accountType: 'SUPPLIER' } });
    if (target === 'position') await prisma.position.update({ where: { id: managerPosition }, data: { status: 'DISABLED' } });
    if (target === 'department') await prisma.department.update({ where: { id: section }, data: { status: 'DISABLED' } });
    if (target === 'organization') await prisma.organization.update({ where: { id: org }, data: { status: 'DISABLED' } });
    expect((await resolve()).responsibilities).toEqual([]);
  });

  it('uses inclusive starts and exclusive ends for appointments and scopes, including adjacent future configurations', async () => {
    await createBinding('SECTION_MANAGER');
    await createBinding('MINISTER');
    await prisma.userPosition.update({ where: { id: managerAssignment }, data: { startedAt: at, endedAt: end } });
    const first = await createScope(section, ministerA, { validFrom: at.toISOString(), validTo: end.toISOString() });
    const nextEnd = new Date('2028-01-01T00:00:00.000Z');
    const next = await createScope(section, ministerB, { validFrom: end.toISOString(), validTo: nextEnd.toISOString() });
    expect((await resolve(new Date(at.getTime() - 1))).responsibilities).toEqual([]);
    expect((await resolve(at)).responsibilities).toHaveLength(2);
    expect((await resolve(new Date(end.getTime() - 1))).responsibilities).toEqual(expect.arrayContaining([expect.objectContaining({ scopeId: first.id })]));
    expect((await resolve(end)).responsibilities).toEqual([expect.objectContaining({ assignmentId: ministerB, scopeId: next.id })]);
    expect((await resolve(nextEnd)).responsibilities).toEqual([]);
  });

  it('requires explicit scope intervals to fit the chosen appointment and rejects reversed or empty intervals', async () => {
    await createBinding('MINISTER');
    await prisma.userPosition.update({ where: { id: ministerA }, data: { startedAt: at, endedAt: end } });
    for (const dates of [
      { validFrom: start.toISOString(), validTo: end.toISOString() },
      { validFrom: at.toISOString(), validTo: null },
      { validFrom: at.toISOString(), validTo: at.toISOString() },
      { validFrom: end.toISOString(), validTo: at.toISOString() },
      { validFrom: at.toISOString(), validTo: new Date(end.getTime() + 1).toISOString() },
    ]) await expect(createScope(section, ministerA, dates)).rejects.toMatchObject({ status: 409 });
    expect(await createScope(section, ministerA, { validFrom: at.toISOString(), validTo: end.toISOString() })).toMatchObject({ version: 1 });
  });

  it('allows exactly one of two concurrent overlapping scope creations and rolls back the loser', async () => {
    await createBinding('MINISTER');
    const outcomes = await Promise.allSettled([ministerA, ministerB].map((id) => createScope(section, id, { validFrom: start.toISOString(), validTo: end.toISOString() })));
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toEqual([expect.objectContaining({ reason: expect.objectContaining({ status: 409 }) })]);
    const rows = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM department_minister_scopes WHERE organization_id = ${org}::uuid`;
    expect(rows[0].count).toBe(1);
    expect(await prisma.auditEvent.count({ where: { organizationId: org, action: 'MINISTER_SCOPE_CREATED' } })).toBe(1);
  });

  it('enforces temporal exclusion and composite organization foreign keys even for direct SQL', async () => {
    await createBinding('MINISTER');
    await createScope(section, ministerA, { validFrom: start.toISOString(), validTo: end.toISOString() });
    const insert = (organizationId: string, assignmentId: string, sectionId = section) => prisma.$executeRaw`
      INSERT INTO department_minister_scopes (id, organization_id, department_id, section_department_id, minister_assignment_id, valid_from, valid_to, created_by, updated_by)
      VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${department}::uuid, ${sectionId}::uuid, ${assignmentId}::uuid, ${start}, ${end}, ${actor.id}::uuid, ${actor.id}::uuid)`;
    await expect(insert(org, ministerB)).rejects.toMatchObject({ code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '23P01' } } } });
    await expect(insert(otherOrg, ministerA)).rejects.toMatchObject({ code: 'P2010' });
    const foreignDepartment = await prisma.department.create({ data: { organizationId: otherOrg, code: randomUUID(), name: 'Foreign department' } });
    const foreignPosition = await prisma.position.create({ data: { organizationId: otherOrg, departmentId: foreignDepartment.id, code: randomUUID(), name: 'Foreign minister' } });
    const foreignAssignment = await prisma.userPosition.create({ data: { organizationId: otherOrg, userId: (await user(otherOrg)).id, positionId: foreignPosition.id, startedAt: start } });
    await expect(insert(org, foreignAssignment.id, secondSection)).rejects.toMatchObject({ code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '23503' } } } });
    await expect(prisma.$executeRaw`DELETE FROM user_positions WHERE id = ${ministerA}::uuid`).rejects.toMatchObject({ code: 'P2010' });
  });

  it('rejects an overlapping scope update with no partial write or successful receipt', async () => {
    await createBinding('MINISTER');
    const first = await createScope(section, ministerA, { validFrom: start.toISOString(), validTo: end.toISOString() });
    const second = await createScope(secondSection, ministerB, { validFrom: start.toISOString(), validTo: end.toISOString() });
    const key = randomUUID();
    await send('patch', `minister-scopes/${second.id}`, { expectedVersion: 1, sectionDepartmentId: section }, key).expect(409);
    expect((await service.listMinisterScopes(org, {})).find(({ id }) => id === second.id)).toMatchObject({ sectionDepartmentId: secondSection, version: 1 });
    expect(await prisma.adminMutation.count({ where: { actorUserId: actor.id, key } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { resourceId: second.id, action: 'MINISTER_SCOPE_UPDATED' } })).toBe(0);
    expect((await resolve()).responsibilities).toEqual([expect.objectContaining({ scopeId: first.id })]);
  });

  it('preserves independent scope history, allows explicit null ends and CAS-serializes simultaneous edits', async () => {
    await createBinding('MINISTER');
    const body = { departmentId: department, sectionDepartmentId: section, ministerAssignmentId: ministerA, validFrom: start.toISOString(), validTo: end.toISOString() };
    const key = randomUUID();
    const first = (await send('post', 'minister-scopes', body, key).expect(201)).body;
    expect((await send('post', 'minister-scopes', body, key).expect(201)).body).toEqual(first);
    const results = await Promise.all([ministerA, ministerB].map((ministerAssignmentId) => send('patch', `minister-scopes/${first.id}`, { expectedVersion: 1, ministerAssignmentId, validTo: null })));
    expect(results.map(({ status }) => status).sort()).toEqual([200, 409]);
    const current = results.find(({ status }) => status === 200)!.body;
    expect(current).toMatchObject({ validFrom: start.toISOString(), validTo: null, version: 2 });
    await send('patch', `minister-scopes/${first.id}`, { expectedVersion: 2, status: 'DISABLED' }).expect(200);
    await createScope(section, ministerB, { validFrom: start.toISOString(), validTo: end.toISOString() });
    expect((await get('minister-scopes').expect(200)).body).toHaveLength(2);
    expect((await get('management-bindings').expect(200)).body).toHaveLength(1);
  });

  it('permits valid field corrections together with disabling rather than inventing a status-only update restriction', async () => {
    await createBinding('MINISTER');
    const scope = await createScope(section, ministerA, { validFrom: start.toISOString(), validTo: end.toISOString() });
    expect(await service.updateMinisterScope(actor, org, scope.id, { expectedVersion: 1, status: 'DISABLED', ministerAssignmentId: ministerB, validTo: null }, randomUUID(), randomUUID())).toMatchObject({ ministerAssignmentId: ministerB, status: 'DISABLED', validTo: null, version: 2 });
  });

  it('resolves nested descendant sections but reports a missing or ineffective minister assignment without falling back to the other minister', async () => {
    await createBinding('MINISTER');
    const nested = await prisma.department.create({ data: { organizationId: org, parentId: section, code: randomUUID(), name: 'Nested section' } });
    await createScope(nested.id, ministerA, { validFrom: start.toISOString(), validTo: end.toISOString() });
    expect((await resolve(at, nested.id)).responsibilities).toEqual([expect.objectContaining({ assignmentId: ministerA })]);
    await prisma.userPosition.update({ where: { id: ministerA }, data: { endedAt: at } });
    expect((await resolve(at, nested.id)).issues).toContainEqual({ responsibility: 'MINISTER', code: 'ASSIGNMENT_MISSING' });
    expect((await resolve(at, nested.id)).responsibilities).toEqual([]);
    await prisma.$executeRaw`UPDATE department_management_bindings SET status = 'DISABLED' WHERE organization_id = ${org}::uuid`;
    expect((await resolve(at, nested.id)).issues).toContainEqual({ responsibility: 'MINISTER', code: 'BINDING_MISSING' });
  });

  it('defaults scope dates to now and the appointment end without requiring a future configuration', async () => {
    await createBinding('MINISTER');
    await prisma.userPosition.update({ where: { id: ministerA }, data: { endedAt: end } });
    const before = Date.now();
    const scope = await createScope();
    expect(Date.parse(String(scope.validFrom))).toBeGreaterThanOrEqual(before);
    expect(Date.parse(String(scope.validFrom))).toBeLessThanOrEqual(Date.now());
    expect(scope.validTo).toBe(end.toISOString());
    expect((await service.managementResponsibilities(org, section)).responsibilities).toEqual([expect.objectContaining({ assignmentId: ministerA })]);
  });

  it('replays binding creation once, preserves versions on replay, rejects changed payloads and leaves authorization untouched', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    const positionBefore = await prisma.position.findUniqueOrThrow({ where: { id: managerPosition } });
    const body = { departmentId: section, responsibility: 'SECTION_MANAGER', positionId: managerPosition };
    const key = randomUUID();
    const first = await send('post', 'management-bindings', body, key).expect(201);
    expect((await send('post', 'management-bindings', body, key).expect(201)).body).toEqual(first.body);
    await send('post', 'management-bindings', { ...body, responsibility: 'MINISTER' }, key).expect(409);
    const updated = (await send('patch', `management-bindings/${first.body.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200)).body;
    expect(updated.version).toBe(2);
    await send('patch', `management-bindings/${first.body.id}`, { expectedVersion: 1, status: 'ACTIVE' }).expect(409);
    expect(await prisma.auditEvent.count({ where: { resourceId: first.body.id, action: 'MANAGEMENT_BINDING_CREATED' } })).toBe(1);
    expect((await prisma.position.findUniqueOrThrow({ where: { id: managerPosition } })).roleVersion).toBe(positionBefore.roleVersion);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor.id } })).securityVersion).toBe(before.securityVersion);
    expect(await app.get(SessionService).resolve(cookie.match(/qms_session=([^;]+)/)![1])).not.toBeNull();
  });

  it('keeps disabled binding history and permits only one active binding for each department and fixed responsibility', async () => {
    const first = await createBinding('SECTION_MANAGER');
    await expect(createBinding('SECTION_MANAGER')).rejects.toMatchObject({ status: 409 });
    await service.updateManagementBinding(actor, org, first.id, { expectedVersion: 1, status: 'DISABLED' }, randomUUID(), randomUUID());
    const next = await createBinding('SECTION_MANAGER');
    expect(next.id).not.toBe(first.id);
    const bindings = await service.listManagementBindings(org, { departmentId: section });
    expect(bindings).toHaveLength(2);
    await expect(service.updateManagementBinding(actor, org, first.id, { expectedVersion: 2, status: 'ACTIVE' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('CAS-updates scopes atomically, preserves omitted fields and audits exact before and after values', async () => {
    const binding = await createBinding('MINISTER');
    const scope = await createScope(section, ministerA, { validFrom: start.toISOString(), validTo: end.toISOString() });
    const body = { expectedVersion: 1, ministerAssignmentId: ministerB };
    const key = randomUUID();
    const changed = (await send('patch', `minister-scopes/${scope.id}`, body, key).expect(200)).body;
    expect(changed).toMatchObject({ sectionDepartmentId: section, ministerAssignmentId: ministerB, validFrom: start.toISOString(), validTo: end.toISOString(), version: 2 });
    expect((await send('patch', `minister-scopes/${scope.id}`, body, key).expect(200)).body).toEqual(changed);
    await send('patch', `minister-scopes/${scope.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: scope.id, action: 'MINISTER_SCOPE_UPDATED' } });
    expect(audit).toMatchObject({ resourceType: 'DepartmentMinisterScope', metadata: {
      departmentId: department, sectionDepartmentId: section, ministerAssignmentId: ministerB,
      previousSectionDepartmentId: section, previousMinisterAssignmentId: ministerA,
      bindingId: binding.id, bindingVersion: 1, validFrom: start.toISOString(), validTo: end.toISOString(),
      previousValidFrom: start.toISOString(), previousValidTo: end.toISOString(),
      status: 'ACTIVE', previousStatus: 'ACTIVE', resourceVersion: 2, previousResourceVersion: 1,
    } });
    const bindingAudit = await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: binding.id, action: 'MANAGEMENT_BINDING_CREATED' } });
    expect(bindingAudit).toMatchObject({ resourceType: 'DepartmentManagementBinding', metadata: { departmentId: department, responsibility: 'MINISTER', positionId: ministerPosition, status: 'ACTIVE', resourceVersion: 1 } });
    expect(await prisma.auditEvent.count({ where: { resourceId: scope.id, action: 'MINISTER_SCOPE_UPDATED' } })).toBe(1);
  });

  it('serializes binding changes with current or future scopes but lets expired scopes remain as history', async () => {
    const binding = await createBinding('MINISTER');
    const scope = await createScope(section, ministerA, { validFrom: '2028-01-01T00:00:00.000Z', validTo: '2029-01-01T00:00:00.000Z' });
    await expect(service.updateManagementBinding(actor, org, binding.id, { expectedVersion: 1, status: 'DISABLED' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await service.updateMinisterScope(actor, org, scope.id, { expectedVersion: 1, status: 'DISABLED' }, randomUUID(), randomUUID());
    const historical = await createScope(section, ministerB, { validFrom: start.toISOString(), validTo: '2026-02-01T00:00:00.000Z' });
    expect(await service.updateManagementBinding(actor, org, binding.id, { expectedVersion: 1, status: 'DISABLED' }, randomUUID(), randomUUID())).toMatchObject({ version: 2 });
    expect((await service.listMinisterScopes(org, {})).map(({ id }) => id)).toEqual(expect.arrayContaining([scope.id, historical.id]));
  });

  it('provides only active INTERNAL same-organization candidates with department filtering, search and stable pagination', async () => {
    await prisma.user.update({ where: { id: dualUser }, data: { fullName: 'Searchable dual appointment' } });
    const result = await get(`responsibility-assignments?departmentId=${department}&search=Searchable&limit=1&offset=0`).expect(200);
    expect(result.body).toMatchObject({ total: 1, items: [{ assignmentId: ministerA, userId: dualUser, positionId: ministerPosition, departmentId: department }] });
    await prisma.user.update({ where: { id: dualUser }, data: { status: 'DISABLED' } });
    expect((await get(`responsibility-assignments?departmentId=${department}&search=Searchable`).expect(200)).body).toEqual({ items: [], total: 0 });
    await get(`responsibility-assignments?departmentId=${department}&limit=101`).expect(400);
    await get('responsibility-assignments').expect(400);
    await get(`management-responsibilities?sectionDepartmentId=${section}&at=2026-01-01`).expect(400);
  });

  it('enforces actual controller authentication, scope, CSRF, idempotency and read-versus-manage permissions', async () => {
    const body = { departmentId: section, responsibility: 'SECTION_MANAGER', positionId: managerPosition };
    await request(app.getHttpServer()).get(`/api/v1/organizations/${org}/management-bindings`).expect(401);
    await get('management-bindings', otherOrg).expect(403);
    await request(app.getHttpServer()).post(`/api/v1/organizations/${org}/management-bindings`).set('Cookie', cookie).send(body).expect(403);
    await request(app.getHttpServer()).post(`/api/v1/organizations/${org}/management-bindings`).set('Cookie', cookie).set('x-csrf-token', csrf).send(body).expect(400);
    const managerPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'organization:structure:manage' } });
    const grant = await prisma.userRole.findFirstOrThrow({ where: { userId: actor.id, organizationId: org } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: grant.roleId, permissionId: managerPermission.id } } });
    await get('management-bindings').expect(200);
    await send('post', 'management-bindings', body).expect(403);
    await get(`management-responsibilities?sectionDepartmentId=${section}`).expect(200);
  });
});
