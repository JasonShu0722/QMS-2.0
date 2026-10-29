import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request, { type Test as HttpTest } from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Requires leased disposable loopback PostgreSQL, never preview 55440.');
}

describe('REQ0031 actual App administrative lifecycle HTTP chains with all three real owners', () => {
  let app: INestApplication, db: PrismaService, sessions: SessionService;
  const csrf = randomUUID();
  const configuration = '/api/v1/admin/configuration';
  const reconfiguration = '/api/v1/admin/reconfiguration';
  const context = '/api/v1/admin/organizations/context';

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    db = app.get(PrismaService);
    sessions = app.get(SessionService);
    expect(await db.$queryRaw`SELECT 1 FROM _prisma_migrations
      WHERE migration_name = '20261028232000_administrative_configuration_links'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL`).toHaveLength(1);
  }, 120_000);
  // Keep immutable identities, receipts and history for parent inspection; never delete fixture data.
  afterAll(async () => { await app?.close(); });

  async function checked(step: string, call: HttpTest, status = 200) {
    const response = await call;
    console.info('APP_CHAIN_HTTP', JSON.stringify({ step, status: response.status,
      ...(response.status >= 400 ? { error: response.body } : {}) }));
    expect({ step, status: response.status, ...(response.status >= 400 ? { error: response.body } : {}) })
      .toMatchObject({ step, status });
    return response.body;
  }
  function get(cookie: string, path: string, query: object = {}) {
    return request(app.getHttpServer()).get(path).set('Cookie', cookie).query(query);
  }
  function write(cookie: string, method: 'post' | 'patch' | 'put' | 'delete', path: string, body: object, key = randomUUID()) {
    return request(app.getHttpServer())[method](path).set('Cookie', cookie)
      .set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }
  async function organization(parentId?: string) {
    return db.organization.create({ data: { code: randomUUID(), name: 'App chain internal scope', type: 'INTERNAL', parentId } });
  }
  async function role(organizationId: string, codes: string[]) {
    const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    return db.role.create({ data: { organizationId, code: randomUUID(), name: 'App chain explicit source',
      permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
  }
  async function person(organizationId: string) {
    const user = await db.user.create({ data: { organizationId, username: randomUUID(), fullName: 'Original historical owner',
      accountType: 'INTERNAL', passwordHash: 'fixture-not-a-login-credential' } });
    const department = await db.department.create({ data: { organizationId, code: randomUUID(), name: 'Original department' } });
    const position = await db.position.create({ data: { organizationId, departmentId: department.id, code: randomUUID(), name: 'Original position' } });
    const source = await role(organizationId, ['organization:read']);
    await db.userRole.create({ data: { organizationId, userId: user.id, roleId: source.id } });
    await db.positionRole.create({ data: { organizationId, positionId: position.id, roleId: source.id } });
    const assignment = await db.userPosition.create({ data: { organizationId, userId: user.id, positionId: position.id,
      startedAt: new Date(Date.now() - 60_000) } });
    const token = await sessions.create(user.id, db, { mfaVerified: true });
    return { user, department, position, role: source, assignment, token, cookie: `qms_session=${token}; qms_csrf=${csrf}` };
  }
  async function fixture() {
    const home = await organization();
    const actor = await db.user.create({ data: { organizationId: home.id, username: randomUUID(),
      accountType: 'INTERNAL', passwordHash: 'fixture-not-a-login-credential' } });
    const marker = await role(home.id, ['platform:admin']);
    await db.userRole.create({ data: { organizationId: home.id, userId: actor.id, roleId: marker.id } });
    const token = await sessions.create(actor.id, db, { mfaVerified: true, reauthenticated: true });
    const cookie = `qms_session=${token}; qms_csrf=${csrf}`;
    const target = await organization(home.id), child = await organization(target.id), grandchild = await organization(child.id);
    const member = await person(target.id);
    const fact = await db.problemIndex.create({ data: { organizationId: target.id, ownerId: member.user.id,
      reportNumber: randomUUID(), domainCode: 'process-quality', problemType: 'defect', sourceType: 'TEST', severity: 'NORMAL' } });
    console.info('APP_CHAIN_FIXTURE', JSON.stringify({ home: home.id, actor: actor.id, target: target.id, child: child.id,
      grandchild: grandchild.id, user: member.user.id, department: member.department.id, position: member.position.id,
      assignment: member.assignment.id, problem: fact.id }));
    expect(await sessions.resolve(token)).toMatchObject({ user: { id: actor.id, organizationId: home.id } });
    expect(await checked('explicit platform actor and target scope', get(cookie, context, { organizationId: target.id })))
      .toMatchObject({ hasPlatformAdministrator: true, accessKind: 'PLATFORM', homeOrganizationId: home.id, targetOrganizationId: target.id,
        permissions: expect.arrayContaining(['organization:force-delete', 'organization:reconfigure', 'account:users:delete']) });
    await checked('ordinary member can use original role before deletion', get(member.cookie, '/api/v1/organizations/current'));
    return { home, actor, token, cookie, target, child, grandchild, member, fact };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function removeOrganization(f: Fixture) {
    const path = `/api/v1/organizations/${f.target.id}/force-delete`;
    const before = await checked('real organization impact preview', get(f.cookie, path));
    expect(before).toMatchObject({ kind: 'ORGANIZATION', id: f.target.id, version: f.target.version,
      counts: { users: 1, departments: 1, positions: 1, assignments: 1, organizations: 2 } });
    expect(before.previewToken).toMatch(/^[a-f0-9]{64}$/);
    const body = { expectedVersion: before.version, confirmed: true, previewToken: before.previewToken };
    expect((await checked('CSRF guard rejects organization mutation', request(app.getHttpServer()).post(path)
      .set('Cookie', f.cookie).set('Idempotency-Key', randomUUID()).send(body), 403)).code).toBe('CSRF_INVALID');
    const key = randomUUID();
    const result = await checked('confirmed organization deletion with three real effects', write(f.cookie, 'post', path, body, key), 201);
    expect(result.effects).toEqual([
      { module: 'workflow', changed: 0, pendingConfiguration: 0 },
      { module: 'platform-configuration', changed: expect.any(Number), pendingConfiguration: expect.any(Number) },
      { module: 'identity', changed: 1, pendingConfiguration: 1 },
    ]);
    expect(await checked('organization idempotent replay', write(f.cookie, 'post', path, body, key), 201)).toEqual(result);
    expect(await db.adminMutation.count({ where: { actorUserId: f.actor.id, key } })).toBe(1);
    return result;
  }
  async function pendingUser(cookie: string, userId: string) {
    // The leased database can retain earlier immutable fixtures; do not assume the first global page contains ours.
    let offset = 0;
    while (true) {
      const page = await checked('global pending USER directory', get(cookie, reconfiguration, { kind: 'USER', pageSize: 100, offset }));
      const item = page.items.find((row: { id: string }) => row.id === userId);
      if (item) return item;
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) throw new Error(`Pending user missing from real global directory: ${userId}`);
    }
  }
  async function projectRows(id: string, mappingId: string) {
    const [project] = await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM component_project_records WHERE id = ${id}::uuid`;
    const [mapping] = await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM component_project_mappings WHERE id = ${mappingId}::uuid`;
    expect(project).toBeDefined(); expect(mapping).toBeDefined();
    return { project: project!, mapping: mapping! };
  }

  it('deletes only the organization, reconfigures the preserved user and adds a genuinely new appointment without moving business history', async () => {
    const f = await fixture();
    const project = await checked('configure project QE through public HTTP', write(f.cookie, 'post',
      `${configuration}/component-project-records?organizationId=${f.target.id}`, { code: randomUUID(), name: 'Original project', stage: 'NEW_PRODUCT',
        customerEngineerAssignmentId: f.member.assignment.id, projectEngineerAssignmentId: f.member.assignment.id }), 201);
    const mapping = await checked('configure component mapping through public HTTP', write(f.cookie, 'post',
      `${configuration}/component-project-mappings?organizationId=${f.target.id}`, { componentCode: randomUUID(), projectRecordId: project.id, productCategory: 'Powertrain' }), 201);
    expect(await checked('original mapping suggests actual QE', get(f.cookie, `${configuration}/component-project-mappings/resolve`,
      { organizationId: f.target.id, componentCode: mapping.componentCode })))
      .toMatchObject({ outcome: 'matched', suggestedQualityEngineerId: f.member.user.id, effectiveQualityEngineerId: f.member.user.id });
    const original = await projectRows(project.id, mapping.id);
    const control = await checked('unrelated surviving-home project', write(f.cookie, 'post',
      `${configuration}/component-project-records?organizationId=${f.home.id}`, { code: randomUUID(), name: 'Unaffected project', stage: 'MASS_PRODUCTION' }), 201);
    const result = await removeOrganization(f);
    expect(result.effects[1]).toEqual({ module: 'platform-configuration', changed: 2, pendingConfiguration: 2 });
    expect(await db.organization.findUniqueOrThrow({ where: { id: f.target.id } }))
      .toMatchObject({ status: 'DISABLED', deletedAt: expect.any(Date), configurationRequired: false, version: f.target.version + 1 });
    expect(await db.organization.findUniqueOrThrow({ where: { id: f.home.id } })).toEqual(f.home);
    expect(await db.organization.findUniqueOrThrow({ where: { id: f.child.id } }))
      .toMatchObject({ parentId: null, status: 'DISABLED', configurationRequired: true, deletedAt: null });
    expect(await db.organization.findUniqueOrThrow({ where: { id: f.grandchild.id } })).toEqual(f.grandchild);
    expect(await db.department.findUniqueOrThrow({ where: { id: f.member.department.id } }))
      .toMatchObject({ organizationId: f.target.id, status: 'DISABLED', configurationRequired: true, deletedAt: null });
    expect(await db.position.findUniqueOrThrow({ where: { id: f.member.position.id } }))
      .toMatchObject({ organizationId: f.target.id, departmentId: f.member.department.id, status: 'DISABLED', configurationRequired: true, deletedAt: null });
    expect(await db.user.findUniqueOrThrow({ where: { id: f.member.user.id } }))
      .toMatchObject({ organizationId: f.target.id, status: 'DISABLED', configurationRequired: true, deletedAt: null,
        securityVersion: f.member.user.securityVersion + 1, credentialVersion: f.member.user.credentialVersion + 1 });
    expect(await db.$queryRaw`SELECT entity_kind, entity_id, original_organization_id, actor_user_id, original_identity
      FROM administrative_deletions WHERE scope_organization_id = ${f.home.id}::uuid`).toEqual([{
      entity_kind: 'ORGANIZATION', entity_id: f.target.id, original_organization_id: f.target.id, actor_user_id: f.actor.id,
      original_identity: { code: f.target.code, name: f.target.name, parentId: f.home.id, type: 'INTERNAL' },
    }]);
    const ended = await db.userPosition.findUniqueOrThrow({ where: { id: f.member.assignment.id } });
    expect(ended).toMatchObject({ organizationId: f.target.id, endedAt: expect.any(Date) });
    expect(await db.session.count({ where: { userId: f.member.user.id, revokedAt: null } })).toBe(0);
    expect(await sessions.resolve(f.member.token)).toBeNull();
    await checked('old user session rejected', get(f.member.cookie, '/api/v1/organizations/current'), 401);
    await expect(app.get(AuthorizationService).assertFeature(f.member.user.id, f.target.id, 'organization:read')).rejects.toMatchObject({ status: 403 });
    // Retained direct-role rows are historical sources, not proof of usable authenticated access.
    expect(await db.userRole.count({ where: { userId: f.member.user.id } })).toBe(1);
    const changed = await projectRows(project.id, mapping.id);
    expect(changed.project).toEqual({ ...original.project, customer_engineer_assignment_id: null, project_engineer_assignment_id: null,
      status: 'DISABLED', version: project.version + 1, updated_by_user_id: f.actor.id, updated_at: expect.any(Date) });
    expect(changed.mapping).toEqual({ ...original.mapping, status: 'DISABLED', version: mapping.version + 1,
      updated_by_user_id: f.actor.id, updated_at: expect.any(Date) });
    expect(await db.$transaction(tx => app.get(ComponentProjectService).resolveForDomain(tx, f.target.id, mapping.componentCode)))
      .toMatchObject({ outcome: 'inactive', suggestedQualityEngineerId: null, effectiveQualityEngineerId: null });
    expect(await checked('surviving-home project unchanged', get(f.cookie, `${configuration}/component-project-records/${control.id}`, { organizationId: f.home.id }))).toEqual(control);
    expect(await db.problemIndex.findUniqueOrThrow({ where: { id: f.fact.id } })).toEqual(f.fact);
    expect(await checked('actor home does not change on deletion', get(f.cookie, context)))
      .toMatchObject({ homeOrganizationId: f.home.id, targetOrganizationId: f.home.id, accessKind: 'PLATFORM' });

    const pending = await pendingUser(f.cookie, f.member.user.id);
    expect(pending).toMatchObject({ kind: 'USER', originalOrganizationId: f.target.id, version: f.member.user.securityVersion + 1,
      reason: 'ORGANIZATION_UNAVAILABLE', requiredConfiguration: ['targetOrganizationId'] });
    const path = `${reconfiguration}/USER/${pending.id}`, key = randomUUID();
    const body = { expectedVersion: pending.version, targetOrganizationId: f.home.id };
    const restored = await checked('real USER reconfiguration to surviving home', write(f.cookie, 'post', path, body, key), 201);
    expect(restored).toMatchObject({ id: f.member.user.id, originalOrganizationId: f.target.id, targetOrganizationId: f.home.id,
      status: 'DISABLED', configurationRequired: false, version: pending.version + 1 });
    expect(await checked('USER reconfiguration replay', write(f.cookie, 'post', path, body, key), 201)).toEqual(restored);
    expect(await db.user.findUniqueOrThrow({ where: { id: f.member.user.id } }))
      .toMatchObject({ organizationId: f.home.id, status: 'DISABLED', configurationRequired: false, deletedAt: null,
        securityVersion: pending.version + 1, credentialVersion: f.member.user.credentialVersion + 2 });
    expect(await db.userRole.count({ where: { userId: f.member.user.id } })).toBe(0);
    expect(await db.userPosition.findUniqueOrThrow({ where: { id: ended.id } })).toEqual(ended);
    const history = await db.userOrganizationHistory.findMany({ where: { userId: f.member.user.id }, select: { organizationId: true } });
    expect(history).toHaveLength(2);
    expect(history).toEqual(expect.arrayContaining([{ organizationId: f.target.id }, { organizationId: f.home.id }]));
    expect(await db.problemIndex.findUniqueOrThrow({ where: { id: f.fact.id } })).toEqual(f.fact);
    await checked('reconfiguration never reactivates old session', get(f.member.cookie, '/api/v1/organizations/current'), 401);

    await checked('explicitly enable reconfigured user', write(f.cookie, 'patch', `/api/v1/admin/users/${pending.id}?organizationId=${f.home.id}`, { status: 'ACTIVE' }));
    expect(await app.get(AuthorizationService).permissionsForContext(pending.id, f.home.id)).toEqual([]);
    const department = await checked('create genuinely new department', write(f.cookie, 'post', `/api/v1/organizations/${f.home.id}/departments`,
      { code: randomUUID(), name: 'New department after reconfiguration' }), 201);
    const position = await checked('create genuinely new position', write(f.cookie, 'post', `/api/v1/organizations/${f.home.id}/positions`,
      { code: randomUUID(), name: 'New position after reconfiguration', departmentId: department.id }), 201);
    const permissionPath = `/api/v1/organizations/${f.home.id}/positions/${position.id}/permissions`;
    const permissions = await checked('read fresh position permission baseline', get(f.cookie, permissionPath));
    await checked('explicitly configure new position permission', write(f.cookie, 'put', permissionPath, {
      permissionCodes: ['organization:read'], expectedPermissionCodes: permissions.permissionCodes, mfaRequired: false,
      expectedMfaRequired: permissions.mfaRequired, expectedRoleVersion: permissions.roleVersion }));
    const preview = await checked('real new appointment authorization preview', write(f.cookie, 'post',
      `/api/v1/organizations/${f.home.id}/position-authorization/preview`, { targetUserId: pending.id, positionIds: [position.id] }));
    const assigned = await checked('explicit new appointment', write(f.cookie, 'put', `/api/v1/organizations/${f.home.id}/users/${pending.id}/positions`,
      { positionIds: [position.id], expectedPositionIds: [], authorizationBaseline: preview.authorizationBaseline }));
    expect(assigned).toHaveLength(1);
    expect(assigned[0]).toMatchObject({ organizationId: f.home.id, userId: pending.id, positionId: position.id, endedAt: null });
    expect(assigned[0].id).not.toBe(ended.id);
    expect(await db.userPosition.findUniqueOrThrow({ where: { id: ended.id } })).toEqual(ended);
    expect(await db.userRole.count({ where: { userId: pending.id } })).toBe(0);
    const freshToken = await sessions.create(pending.id, db, { mfaVerified: true });
    expect(await checked('new session uses only newly appointed home', get(`qms_session=${freshToken}`, '/api/v1/organizations/current')))
      .toMatchObject({ userId: pending.id, organization: { id: f.home.id } });
    expect(await app.get(AuthorizationService).permissionsForContext(pending.id, f.home.id)).toEqual(['organization:read']);
    expect(await db.problemIndex.findUniqueOrThrow({ where: { id: f.fact.id } })).toEqual(f.fact);
    expect(await projectRows(project.id, mapping.id)).toEqual(changed);
    await checked('old session stays revoked after explicit enable and new appointment', get(f.member.cookie, '/api/v1/organizations/current'), 401);
    console.info('APP_CHAIN_COMPLETE', JSON.stringify({ chain: 'organization-reconfiguration-new-appointment', problem: f.fact.id,
      historicalOrganizationId: f.target.id, historicalOwnerId: pending.id, newAssignmentId: assigned[0].id }));
  }, 30_000);

  it('does not report a deleted organization as active by replaying its original creation key', async () => {
    const f = await fixture(), path = `/api/v1/organizations/${f.home.id}/children`, key = randomUUID();
    const body = { code: `REUSE-${randomUUID()}`, name: 'Original creation receipt' };
    const created = await checked('create with actual initialization evidence', write(f.cookie, 'post', path, body, key), 201);
    const removePath = `/api/v1/organizations/${created.id}/force-delete`;
    const preview = await checked('creation replay delete preview', get(f.cookie, removePath));
    await checked('creation replay force delete', write(f.cookie, 'post', removePath, { expectedVersion: preview.version, confirmed: true, previewToken: preview.previewToken }), 201);
    await checked('old creation key cannot return an active tombstone', write(f.cookie, 'post', path, body, key), 409);
    const replacement = await checked('same code is a new organization under a new key', write(f.cookie, 'post', path, body), 201);
    expect(replacement.id).not.toBe(created.id);
    expect(await db.organization.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ deletedAt: expect.any(Date), status: 'DISABLED' });
    expect(await db.organization.findUniqueOrThrow({ where: { id: replacement.id } })).toMatchObject({ deletedAt: null, status: 'ACTIVE', code: body.code });
  }, 30_000);

  it.each(['ORGANIZATION', 'DEPARTMENT'] as const)('rejects the old PATCH route for a permanently deleted %s with a controlled not-found response', async kind => {
    const f = await fixture();
    const department = kind === 'DEPARTMENT' ? await db.department.create({ data: { organizationId: f.home.id, code: randomUUID(), name: 'Permanently deleted section' } }) : null;
    const path = department ? `/api/v1/organizations/${f.home.id}/departments/${department.id}` : `/api/v1/organizations/${f.target.id}`;
    const preview = await checked('old PATCH baseline preview', get(f.cookie, `${path}/force-delete`));
    const deleted = await checked('old PATCH baseline force deletion', write(f.cookie, 'post', `${path}/force-delete`, { expectedVersion: preview.version, confirmed: true, previewToken: preview.previewToken }), 201);
    await checked('deleted identity cannot use ordinary PATCH', write(f.cookie, 'patch', path, { expectedVersion: deleted.version, status: 'ACTIVE' }), 404);
    const retained = department ? await db.department.findUniqueOrThrow({ where: { id: department.id } }) : await db.organization.findUniqueOrThrow({ where: { id: f.target.id } });
    expect(retained).toMatchObject({ status: 'DISABLED', deletedAt: expect.any(Date), version: deleted.version });
  }, 30_000);

  it('force-deletes detached pending organizations and departments without reconfiguration through all three real owners', async () => {
    const f = await fixture(), member = await person(f.child.id);
    const fact = await db.problemIndex.create({ data: { organizationId: f.child.id, ownerId: member.user.id,
      reportNumber: randomUUID(), domainCode: 'process-quality', problemType: 'defect', sourceType: 'TEST', severity: 'NORMAL' } });
    await removeOrganization(f);
    expect(await db.organization.findUniqueOrThrow({ where: { id: f.child.id } }))
      .toMatchObject({ parentId: null, status: 'DISABLED', configurationRequired: true, deletedAt: null });
    const childPath = `/api/v1/organizations/${f.child.id}/force-delete`;
    const preview = await checked('detached organization remains force-deletable', get(f.cookie, childPath));
    const childKey = randomUUID(), childBody = { expectedVersion: preview.version, confirmed: true, previewToken: preview.previewToken };
    const childResult = await checked('delete detached organization without reparenting or activation', write(f.cookie, 'post', childPath, childBody, childKey), 201);
    expect(await checked('detached organization deletion replay', write(f.cookie, 'post', childPath, childBody, childKey), 201)).toEqual(childResult);
    expect(await db.organization.findUniqueOrThrow({ where: { id: f.child.id } }))
      .toMatchObject({ deletedAt: expect.any(Date), status: 'DISABLED', configurationRequired: false, parentId: null });
    expect(await db.organization.findUniqueOrThrow({ where: { id: f.grandchild.id } }))
      .toMatchObject({ deletedAt: null, status: 'DISABLED', configurationRequired: true, parentId: null });
    expect(await db.user.findUniqueOrThrow({ where: { id: member.user.id } }))
      .toMatchObject({ deletedAt: null, organizationId: f.child.id, configurationRequired: true, status: 'DISABLED' });
    expect(await sessions.resolve(member.token)).toBeNull();
    expect(await db.userPosition.findUniqueOrThrow({ where: { id: member.assignment.id } })).toHaveProperty('endedAt', expect.any(Date));
    expect(await db.problemIndex.findUniqueOrThrow({ where: { id: fact.id } })).toEqual(fact);

    const departmentPath = `/api/v1/organizations/${f.target.id}/departments/${f.member.department.id}/force-delete`;
    const departmentPreview = await checked('pending department under deleted original organization remains force-deletable', get(f.cookie, departmentPath));
    const departmentKey = randomUUID(), departmentBody = { expectedVersion: departmentPreview.version, confirmed: true, previewToken: departmentPreview.previewToken };
    const departmentResult = await checked('delete pending department without restoring its original organization', write(f.cookie, 'post', departmentPath, departmentBody, departmentKey), 201);
    expect(await checked('pending department deletion replay', write(f.cookie, 'post', departmentPath, departmentBody, departmentKey), 201)).toEqual(departmentResult);
    expect(await db.department.findUniqueOrThrow({ where: { id: f.member.department.id } }))
      .toMatchObject({ deletedAt: expect.any(Date), configurationRequired: false, organizationId: f.target.id });
    expect(await db.position.findUniqueOrThrow({ where: { id: f.member.position.id } }))
      .toMatchObject({ deletedAt: null, status: 'DISABLED', configurationRequired: true, organizationId: f.target.id });
    expect(await db.user.findUniqueOrThrow({ where: { id: f.member.user.id } }))
      .toMatchObject({ deletedAt: null, organizationId: f.target.id, configurationRequired: true });
    expect(await db.problemIndex.findUniqueOrThrow({ where: { id: f.fact.id } })).toEqual(f.fact);
    expect(await db.organization.findUniqueOrThrow({ where: { id: f.home.id } })).toEqual(f.home);
  }, 30_000);

  it('deletes a user in a surviving pending organization and replays only under current home authority without a 5xx', async () => {
    const f = await fixture();
    const member = await person(f.child.id);
    console.info('APP_CHAIN_PENDING_USER', JSON.stringify({ organizationId: f.child.id, userId: member.user.id, assignmentId: member.assignment.id }));
    const fact = await db.problemIndex.create({ data: { organizationId: f.child.id, ownerId: member.user.id, reportNumber: randomUUID(),
      domainCode: 'process-quality', problemType: 'defect', sourceType: 'TEST', severity: 'NORMAL' } });
    await removeOrganization(f);
    expect(await db.organization.findUniqueOrThrow({ where: { id: f.child.id } }))
      .toMatchObject({ deletedAt: null, status: 'DISABLED', configurationRequired: true });
    const path = `/api/v1/admin/users/${member.user.id}?organizationId=${f.child.id}`, key = randomUUID();
    const body = { expectedSecurityVersion: member.user.securityVersion };
    expect((await checked('pending-scope USER CSRF rejection', request(app.getHttpServer()).delete(path)
      .set('Cookie', f.cookie).set('Idempotency-Key', key).send(body), 403)).code).toBe('CSRF_INVALID');
    const result = await checked('whole-App USER delete from pending organization', write(f.cookie, 'delete', path, body, key));
    expect(result).toEqual({ userId: member.user.id, deleted: true, effects: [
      { module: 'workflow', changed: 0, pendingConfiguration: 0 },
      { module: 'platform-configuration', changed: 0, pendingConfiguration: 0 },
      { module: 'identity', changed: 1, pendingConfiguration: 0 },
    ] });
    const deleted = await db.user.findUniqueOrThrow({ where: { id: member.user.id } });
    expect(deleted).toMatchObject({ organizationId: f.child.id, deletedAt: expect.any(Date), status: 'DISABLED',
      configurationRequired: false, securityVersion: member.user.securityVersion + 1, credentialVersion: member.user.credentialVersion + 1 });
    expect(await checked('whole-App USER deletion idempotent replay', write(f.cookie, 'delete', path, body, key))).toEqual(result);
    expect(await db.user.findUniqueOrThrow({ where: { id: member.user.id } })).toEqual(deleted);
    expect(await db.adminMutation.count({ where: { actorUserId: f.actor.id, key, organizationId: f.home.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { actorUserId: f.actor.id, resourceId: member.user.id, action: 'USER_FORCE_DELETED' } })).toBe(1);
    expect(await db.userRole.count({ where: { userId: member.user.id } })).toBe(0);
    expect(await db.role.findUniqueOrThrow({ where: { id: member.role.id } })).toEqual(member.role);
    expect(await db.userPosition.findUniqueOrThrow({ where: { id: member.assignment.id } })).toHaveProperty('endedAt', expect.any(Date));
    expect(await db.position.findUniqueOrThrow({ where: { id: member.position.id } })).toEqual(member.position);
    expect(await sessions.resolve(member.token)).toBeNull();
    expect(await db.session.count({ where: { userId: member.user.id, revokedAt: null } })).toBe(0);
    await checked('deleted pending-scope user cannot reuse session', get(member.cookie, '/api/v1/organizations/current'), 401);
    expect(await db.problemIndex.findUniqueOrThrow({ where: { id: fact.id } })).toEqual(fact);
    await checked('wrong historical scope controlled denial', write(f.cookie, 'delete',
      `/api/v1/admin/users/${member.user.id}?organizationId=${f.home.id}`, body, randomUUID()), 404);
    // Real revocation, not an authorization override: even an old success receipt cannot bypass current authority.
    await db.userRole.deleteMany({ where: { userId: f.actor.id } });
    expect((await checked('replay rechecks currently revoked marker', write(f.cookie, 'delete', path, body, key), 403)).code).toBe('FEATURE_PERMISSION_DENIED');
    expect(await db.user.findUniqueOrThrow({ where: { id: member.user.id } })).toEqual(deleted);
    expect(await db.problemIndex.findUniqueOrThrow({ where: { id: fact.id } })).toEqual(fact);
    console.info('APP_CHAIN_COMPLETE', JSON.stringify({ chain: 'pending-organization-user-delete-replay', home: f.home.id,
      pendingOrganizationId: f.child.id, deletedUserId: member.user.id, historicalProblemId: fact.id }));
  }, 30_000);
});
