import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AuthenticatedGuard } from '../../src/common/guards/authenticated.guard.js';
import { CsrfGuard } from '../../src/modules/identity/csrf.guard.js';
import { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import { OrganizationScopeService } from '../../src/modules/organization/organization-scope.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { AdministrativeReconfigurationController } from '../../src/administrative-reconfiguration.controller.js';
import { OrganizationReconfigurationService } from '../../src/modules/organization/organization-reconfiguration.service.js';
import { AdminUserReconfigurationService } from '../../src/modules/identity/admin-user-reconfiguration.service.js';
import { AdminUserLifecycleService } from '../../src/modules/identity/admin-user-lifecycle.service.js';
import { ESignatureService } from '../../src/modules/e-signature/e-signature.service.js';
import { AdministrativeLifecycleRegistry } from '../../src/common/security/administrative-lifecycle.registry.js';
import { Client } from 'pg';

// Isolated command module: full AppModule/workflow/configuration registration is verified by the parent.
describe('REQ0031 reconfiguration isolated HTTP and real PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let sessions: SessionService;

  beforeAll(async () => {
    if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
      throw new Error('Requires explicitly disposable loopback PostgreSQL; preview 55440 is forbidden.');
    }
    app = (await Test.createTestingModule({ controllers: [AdministrativeReconfigurationController], providers: [
      PrismaService, AuditLogService, AdminMutationService, SessionService, AuthorizationService, OrganizationScopeService,
      OrganizationReconfigurationService, AdminUserReconfigurationService, AdminUserLifecycleService, ESignatureService, AdministrativeLifecycleRegistry,
      { provide: APP_GUARD, useClass: AuthenticatedGuard }, { provide: APP_GUARD, useClass: CsrfGuard },
    ] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    db = app.get(PrismaService);
    sessions = app.get(SessionService);
    expect(await db.$queryRaw`SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261028230000_administrative_lifecycle' AND finished_at IS NOT NULL`).toHaveLength(1);
  });
  afterAll(async () => { await app?.close(); });

  async function organization(data: { status?: 'ACTIVE' | 'DISABLED'; configurationRequired?: boolean; deletedAt?: Date; parentId?: string; type?: 'INTERNAL' | 'SUPPLIER' } = {}) {
    return db.organization.create({ data: { code: randomUUID(), name: 'Reconfiguration scope', type: 'INTERNAL', ...data } });
  }
  async function administrator(marker = true, accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const home = await organization({ type: accountType });
    const user = await db.user.create({ data: { organizationId: home.id, username: randomUUID(), accountType, passwordHash: 'test-only' } });
    const codes = ['organization:reconfigure', ...(marker ? ['platform:admin'] : [])];
    const permissions = await Promise.all(codes.map(code => db.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    const role = await db.role.create({ data: { organizationId: home.id, code: randomUUID(), name: 'Reconfiguration administrator', permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    await db.userRole.create({ data: { userId: user.id, organizationId: home.id, roleId: role.id } });
    const token = await sessions.create(user.id, db, { mfaVerified: true, reauthenticated: true });
    const session = (await sessions.resolve(token))!;
    return { home, user, role, session, token, cookie: `qms_session=${token}; qms_csrf=reconfiguration` };
  }
  const path = '/api/v1/admin/reconfiguration';
  function restore(admin: Awaited<ReturnType<typeof administrator>>, kind: string, id: string, body: object, key = randomUUID()) {
    return request(app.getHttpServer()).post(`${path}/${kind}/${id}`).set('Cookie', admin.cookie)
      .set('x-csrf-token', 'reconfiguration').set('Idempotency-Key', key).send(body);
  }

  it('lists internal pending scopes across deleted parents, filtering before pagination', async () => {
    const admin = await administrator();
    const deleted = await organization({ status: 'DISABLED', deletedAt: new Date() });
    const pending = await organization({ status: 'DISABLED', configurationRequired: true });
    const department = await db.department.create({ data: { organizationId: deleted.id, code: randomUUID(), name: 'Orphan department', status: 'DISABLED', configurationRequired: true } });
    await organization({ type: 'SUPPLIER', status: 'DISABLED', configurationRequired: true });
    const response = await request(app.getHttpServer()).get(path).query({ kind: 'DEPARTMENT', pageSize: 50, offset: 0 }).set('Cookie', admin.cookie).expect(200);
    expect(response.body.items).toContainEqual(expect.objectContaining({ kind: 'DEPARTMENT', id: department.id, originalOrganizationId: deleted.id, version: 1 }));
    const organizations = await request(app.getHttpServer()).get(path).query({ kind: 'ORGANIZATION', pageSize: 100, offset: 0 }).set('Cookie', admin.cookie).expect(200);
    expect(organizations.body.items).toContainEqual(expect.objectContaining({ id: pending.id }));
    expect(organizations.body.items.some((item: { id: string }) => item.id === deleted.id)).toBe(false);
    const next = await request(app.getHttpServer()).get(path).query({ kind: 'ORGANIZATION', pageSize: 1, offset: 1 }).set('Cookie', admin.cookie).expect(200);
    expect(next.body.items).toEqual(organizations.body.items.slice(1, 2));
    expect(next.body.total).toBe(organizations.body.total);
  });

  it('requires a real internal platform marker and current authentication for reads', async () => {
    for (const admin of [await administrator(false), await administrator(true, 'SUPPLIER')]) {
      await request(app.getHttpServer()).get(path).query({ kind: 'USER' }).set('Cookie', admin.cookie).expect(403);
    }
    const admin = await administrator();
    await db.session.update({ where: { id: admin.session.id }, data: { reauthenticatedAt: null } });
    await request(app.getHttpServer()).get(path).query({ kind: 'USER' }).set('Cookie', admin.cookie).expect(200);
    await db.userRole.deleteMany({ where: { userId: admin.user.id } });
    await request(app.getHttpServer()).get(path).query({ kind: 'USER' }).set('Cookie', admin.cookie).expect(403);
  });

  it('restores only pending organizations under an active internal parent and revokes old sessions before activation', async () => {
    const admin = await administrator();
    const pending = await organization({ status: 'DISABLED', configurationRequired: true });
    const user = await db.user.create({ data: { organizationId: pending.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const oldToken = await sessions.create(user.id, db, { mfaVerified: true });
    const key = randomUUID();
    const body = { expectedVersion: 1, parentId: admin.home.id };
    const response = await restore(admin, 'ORGANIZATION', pending.id, body, key).expect(201);
    expect(response.body).toMatchObject({ id: pending.id, version: 2, configurationRequired: false, status: 'ACTIVE' });
    expect(await db.organization.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ parentId: admin.home.id, configurationRequired: false, status: 'ACTIVE' });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ organizationId: pending.id, securityVersion: 2 });
    expect(await sessions.resolve(oldToken)).toBeNull();
    expect((await restore(admin, 'ORGANIZATION', pending.id, body, key).expect(201)).body).toEqual(response.body);
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toHaveProperty('securityVersion', 2);
    expect(await db.adminMutation.findFirstOrThrow({ where: { actorUserId: admin.user.id, key } })).toHaveProperty('organizationId', admin.home.id);
    await db.userRole.deleteMany({ where: { userId: admin.user.id } });
    await restore(admin, 'ORGANIZATION', pending.id, body, key).expect(403);
  });

  it('rejects cycles, suppliers, deleted/nonpending identities, stale versions and untrusted actor payloads', async () => {
    const admin = await administrator();
    const pending = await organization({ status: 'DISABLED', configurationRequired: true });
    const child = await organization({ parentId: pending.id });
    await restore(admin, 'ORGANIZATION', pending.id, { expectedVersion: 1, parentId: child.id }).expect(400);
    const supplier = await organization({ type: 'SUPPLIER' });
    await restore(admin, 'ORGANIZATION', pending.id, { expectedVersion: 1, parentId: supplier.id }).expect(400);
    await restore(admin, 'ORGANIZATION', pending.id, { expectedVersion: 5, parentId: admin.home.id }).expect(409);
    await restore(admin, 'ORGANIZATION', pending.id, { expectedVersion: 1, parentId: admin.home.id, actor: admin.user }).expect(400);
    await restore(admin, 'ORGANIZATION', admin.home.id, { expectedVersion: 1, parentId: pending.id }).expect(409);
    const deleted = await organization({ status: 'DISABLED', deletedAt: new Date() });
    await restore(admin, 'ORGANIZATION', deleted.id, { expectedVersion: 1, parentId: admin.home.id }).expect(404);
    expect(await db.organization.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ configurationRequired: true, version: 1 });
  });

  it('restores a department in its own scope and leaves a reconfigured position disabled with no inherited grants', async () => {
    const admin = await administrator();
    const department = await db.department.create({ data: { organizationId: admin.home.id, code: randomUUID(), name: 'Pending department', status: 'DISABLED', configurationRequired: true } });
    const position = await db.position.create({ data: { organizationId: admin.home.id, departmentId: department.id, code: randomUUID(), name: 'Pending position', status: 'DISABLED', configurationRequired: true } });
    await restore(admin, 'DEPARTMENT', department.id, { expectedVersion: 1, parentId: null }).expect(201);
    await restore(admin, 'POSITION', position.id, { expectedVersion: 1, targetDepartmentId: department.id }).expect(201);
    expect(await db.department.findUniqueOrThrow({ where: { id: department.id } })).toMatchObject({ organizationId: admin.home.id, status: 'ACTIVE', configurationRequired: false, version: 2 });
    expect(await db.position.findUniqueOrThrow({ where: { id: position.id } })).toMatchObject({ organizationId: admin.home.id, status: 'DISABLED', configurationRequired: false, version: 2 });
    expect(await db.positionRole.count({ where: { positionId: position.id } })).toBe(0);
    const other = await organization();
    const foreignDepartment = await db.department.create({ data: { organizationId: other.id, code: randomUUID(), name: 'Foreign department' } });
    const pending = await db.department.create({ data: { organizationId: admin.home.id, code: randomUUID(), name: 'Pending', status: 'DISABLED', configurationRequired: true } });
    await restore(admin, 'DEPARTMENT', pending.id, { expectedVersion: 1, parentId: foreignDepartment.id }).expect(400);
  });

  it('requires recent authentication for writes even when pending directory remains readable', async () => {
    const admin = await administrator();
    const pending = await organization({ status: 'DISABLED', configurationRequired: true });
    await db.session.update({ where: { id: admin.session.id }, data: { reauthenticatedAt: new Date(Date.now() - 600_000) } });
    await restore(admin, 'ORGANIZATION', pending.id, { expectedVersion: 1, parentId: admin.home.id }).expect(403);
    expect(await db.organization.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ configurationRequired: true, version: 1 });
  });

  it('reconfigures a same-scope pending user without inheriting roles, appointments or credentials', async () => {
    const admin = await administrator();
    const user = await db.user.create({ data: { organizationId: admin.home.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only', status: 'DISABLED', configurationRequired: true } });
    await db.userRole.create({ data: { organizationId: admin.home.id, userId: user.id, roleId: admin.role.id } });
    const oldToken = await sessions.create(user.id, db, { mfaVerified: true });
    const key = randomUUID();
    const result = await restore(admin, 'USER', user.id, { expectedVersion: 1 }, key).expect(201);
    expect(result.body).toMatchObject({ id: user.id, version: 2, status: 'DISABLED', configurationRequired: false });
    expect(await db.userRole.count({ where: { userId: user.id } })).toBe(0);
    expect(await sessions.resolve(oldToken)).toBeNull();
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ organizationId: admin.home.id, securityVersion: 2, credentialVersion: 2 });
    const deleted = await db.user.create({ data: { organizationId: admin.home.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only', status: 'DISABLED', deletedAt: new Date() } });
    await restore(admin, 'USER', deleted.id, { expectedVersion: 1, targetOrganizationId: admin.home.id }).expect(404);
  });

  it('moves only a pending internal user through the 132 bridge while preserving historical tenant facts', async () => {
    expect(await db.$queryRaw`SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261028231000_administrative_identity_history' AND finished_at IS NOT NULL`).toHaveLength(1);
    const admin = await administrator();
    const old = await organization();
    const user = await db.user.create({ data: { organizationId: old.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const fact = await db.problemIndex.create({ data: { organizationId: old.id, reportNumber: randomUUID(), domainCode: 'process-quality', problemType: 'defect', sourceType: 'TEST', severity: 'NORMAL', ownerId: user.id } });
    // The ordinary path must not acquire the special transaction-local approval.
    await expect(db.user.update({ where: { id: user.id }, data: { organizationId: admin.home.id } })).rejects.toThrow();
    await db.organization.update({ where: { id: old.id }, data: { status: 'DISABLED', deletedAt: new Date() } });
    await db.user.update({ where: { id: user.id }, data: { status: 'DISABLED', configurationRequired: true } });
    await restore(admin, 'USER', user.id, { expectedVersion: 1 }).expect(400);
    const key = randomUUID();
    const input = { expectedVersion: 1, targetOrganizationId: admin.home.id };
    const result = await restore(admin, 'USER', user.id, input, key).expect(201);
    expect(result.body).toMatchObject({ id: user.id, originalOrganizationId: old.id, targetOrganizationId: admin.home.id, status: 'DISABLED', version: 2 });
    expect(await db.problemIndex.findUniqueOrThrow({ where: { id: fact.id } })).toMatchObject({ organizationId: old.id, ownerId: user.id });
    expect(await db.userOrganizationHistory.findMany({ where: { userId: user.id }, orderBy: { organizationId: 'asc' } })).toHaveLength(2);
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ id: user.id, organizationId: admin.home.id, configurationRequired: false, securityVersion: 2 });
    expect(await db.userRole.count({ where: { userId: user.id } })).toBe(0);
    expect((await restore(admin, 'USER', user.id, input, key).expect(201)).body).toEqual(result.body);
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toHaveProperty('securityVersion', 2);
    const supplier = await db.user.create({ data: { organizationId: old.id, username: randomUUID(), accountType: 'SUPPLIER', passwordHash: 'test-only', status: 'DISABLED', configurationRequired: true } });
    await restore(admin, 'USER', supplier.id, { expectedVersion: 1, targetOrganizationId: admin.home.id }).expect(403);
  });

  it('rolls back activation, credential invalidation, audit and receipt when the real audit INSERT fails', async () => {
    const admin = await administrator();
    const pending = await organization({ status: 'DISABLED', configurationRequired: true });
    const user = await db.user.create({ data: { organizationId: pending.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const token = await sessions.create(user.id, db);
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    const functionName = `test_reconfiguration_audit_${randomUUID().replaceAll('-', '')}`;
    const key = randomUUID();
    await client.connect();
    try {
      await client.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.action = 'ORGANIZATION_RECONFIGURED' AND NEW.resource_id = '${pending.id}' THEN
          RAISE EXCEPTION 'TEST_RECONFIGURATION_AUDIT_ROLLBACK';
        END IF; RETURN NEW; END $$`);
      await client.query(`CREATE TRIGGER ${functionName} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
      await restore(admin, 'ORGANIZATION', pending.id, { expectedVersion: 1, parentId: admin.home.id }, key).expect(500);
      expect(await db.organization.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ parentId: null, configurationRequired: true, status: 'DISABLED', version: 1 });
      expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toHaveProperty('securityVersion', 1);
      expect(await db.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
      expect(await db.adminMutation.count({ where: { actorUserId: admin.user.id, key } })).toBe(0);
    } finally {
      await client.query(`DROP TRIGGER IF EXISTS ${functionName} ON audit_events`);
      await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await client.end();
    }
    await restore(admin, 'ORGANIZATION', pending.id, { expectedVersion: 1, parentId: admin.home.id }, key).expect(201);
    expect(await sessions.resolve(token)).toBeNull();
  });

  it('serializes competing commands with CAS and rejects mismatched idempotency payloads', async () => {
    const admin = await administrator();
    const pending = await organization({ status: 'DISABLED', configurationRequired: true });
    const results = await Promise.all([restore(admin, 'ORGANIZATION', pending.id, { expectedVersion: 1, parentId: admin.home.id }),
      restore(admin, 'ORGANIZATION', pending.id, { expectedVersion: 1, parentId: admin.home.id })]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    const next = await organization({ status: 'DISABLED', configurationRequired: true });
    const key = randomUUID();
    await restore(admin, 'ORGANIZATION', next.id, { expectedVersion: 1, parentId: admin.home.id }, key).expect(201);
    await restore(admin, 'ORGANIZATION', next.id, { expectedVersion: 2, parentId: admin.home.id }, key).expect(409);
  });

  it('records a replacement department without moving the deleted organization historical owner', async () => {
    const admin = await administrator();
    const old = await organization({ status: 'DISABLED', deletedAt: new Date() });
    const source = await db.department.create({ data: { organizationId: old.id, code: randomUUID(), name: 'Historical department', status: 'DISABLED', configurationRequired: true } });
    const replacement = await db.department.create({ data: { organizationId: admin.home.id, code: randomUUID(), name: 'Replacement department' } });
    const key = randomUUID();
    const input = { expectedVersion: 1, targetOrganizationId: admin.home.id, targetDepartmentId: replacement.id };
    const response = await restore(admin, 'DEPARTMENT', source.id, input, key).expect(201);
    expect(response.body).toMatchObject({ originalOrganizationId: old.id, targetOrganizationId: admin.home.id, replacementId: replacement.id, status: 'DISABLED', version: 2 });
    expect(await db.department.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({ organizationId: old.id, configurationRequired: false, status: 'DISABLED', version: 2 });
    expect(await db.$queryRaw`SELECT kind, source_orgid, replacement_id, replacement_orgid, actor_id FROM administrative_configuration_links WHERE kind = 'DEPARTMENT' AND source_id = ${source.id}::uuid`)
      .toEqual([{ kind: 'DEPARTMENT', source_orgid: old.id, replacement_id: replacement.id, replacement_orgid: admin.home.id, actor_id: admin.user.id }]);
    expect((await restore(admin, 'DEPARTMENT', source.id, input, key).expect(201)).body).toEqual(response.body);
    await restore(admin, 'DEPARTMENT', source.id, input).expect(409);
    const directory = await request(app.getHttpServer()).get(path).query({ kind: 'DEPARTMENT' }).set('Cookie', admin.cookie).expect(200);
    expect(directory.body.items.some((item: { id: string }) => item.id === source.id)).toBe(false);
  });

  it.each(['PQE', 'P'.repeat(64)])('recovers two deleted scopes with occupied position code %s without overwriting identities or replaying writes', async code => {
    const admin = await administrator();
    const targetDepartment = await db.department.create({ data: { organizationId: admin.home.id, code: randomUUID(), name: 'Destination department' } });
    const existing = await db.position.create({ data: { organizationId: admin.home.id, departmentId: targetDepartment.id, code, name: 'Existing PQE' } });
    const existingRole = await db.positionRole.create({ data: { organizationId: admin.home.id, positionId: existing.id, roleId: admin.role.id } });
    const existingAppointment = await db.userPosition.create({ data: { organizationId: admin.home.id, positionId: existing.id, userId: admin.user.id } });
    const sources = [];
    for (let index = 0; index < 2; index++) {
      const old = await organization();
      const department = await db.department.create({ data: { organizationId: old.id, code: randomUUID(), name: 'Historical department' } });
      const position = await db.position.create({ data: { organizationId: old.id, departmentId: department.id, code, name: `Historical PQE ${index}`, status: 'DISABLED', configurationRequired: true } });
      const role = await db.role.create({ data: { organizationId: old.id, code: randomUUID(), name: 'Historical role' } });
      const positionRole = await db.positionRole.create({ data: { organizationId: old.id, positionId: position.id, roleId: role.id } });
      const user = await db.user.create({ data: { organizationId: old.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
      const appointment = await db.userPosition.create({ data: { organizationId: old.id, positionId: position.id, userId: user.id, endedAt: new Date() } });
      await db.organization.update({ where: { id: old.id }, data: { status: 'DISABLED', deletedAt: new Date() } });
      sources.push({ position, positionRole, appointment });
    }
    const input = { expectedVersion: 1, targetOrganizationId: admin.home.id, targetDepartmentId: targetDepartment.id };
    const replacements = [];
    for (const { position, positionRole, appointment } of sources) {
      const key = randomUUID();
      const response = await restore(admin, 'POSITION', position.id, input, key).expect(201);
      const replacement = await db.position.findUniqueOrThrow({ where: { id: response.body.replacementId as string } });
      expect(response.body).toMatchObject({ id: position.id, originalOrganizationId: position.organizationId, targetOrganizationId: admin.home.id, status: 'DISABLED', configurationRequired: false, version: 2 });
      expect(replacement.id).not.toBe(position.id);
      expect(replacement.id).not.toBe(existing.id);
      expect(replacement.code).not.toBe(code);
      expect(replacement.code.length).toBeLessThanOrEqual(64);
      expect(replacement.code).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      expect(replacement.code.startsWith(code.slice(0, 27))).toBe(true);
      expect(replacement.code.endsWith(replacement.id)).toBe(true);
      expect(replacement).toMatchObject({ organizationId: admin.home.id, departmentId: targetDepartment.id, name: position.name, status: 'DISABLED', configurationRequired: false, categoryId: null });
      expect(await db.positionRole.count({ where: { positionId: replacement.id } })).toBe(0);
      expect(await db.userPosition.count({ where: { positionId: replacement.id } })).toBe(0);
      expect(await db.position.findUniqueOrThrow({ where: { id: position.id } })).toEqual({ ...position, configurationRequired: false, version: 2, updatedAt: expect.any(Date) });
      expect(await db.positionRole.findMany({ where: { positionId: position.id } })).toEqual([positionRole]);
      expect(await db.userPosition.findMany({ where: { positionId: position.id } })).toEqual([appointment]);
      expect(await db.$queryRaw`SELECT source_orgid, replacement_id, replacement_orgid FROM administrative_configuration_links WHERE kind = 'POSITION' AND source_id = ${position.id}::uuid`)
        .toEqual([{ source_orgid: position.organizationId, replacement_id: replacement.id, replacement_orgid: admin.home.id }]);
      expect((await restore(admin, 'POSITION', position.id, input, key).expect(201)).body).toEqual(response.body);
      expect(await db.position.findUniqueOrThrow({ where: { id: replacement.id } })).toEqual(replacement);
      expect(await db.auditEvent.count({ where: { resourceId: position.id, action: 'POSITION_RECONFIGURED' } })).toBe(1);
      expect(await db.adminMutation.count({ where: { actorUserId: admin.user.id, key } })).toBe(1);
      await restore(admin, 'POSITION', position.id, { ...input, expectedVersion: 2 }, key).expect(409);
      await restore(admin, 'POSITION', position.id, input).expect(409);
      replacements.push({ replacement, key, sourceId: position.id });
    }
    expect(new Set(replacements.map(({ replacement }) => replacement.id)).size).toBe(2);
    expect(new Set(replacements.map(({ replacement }) => replacement.code)).size).toBe(2);
    const first = replacements[0]!;
    await db.session.update({ where: { id: admin.session.id }, data: { reauthenticatedAt: null } });
    await restore(admin, 'POSITION', first.sourceId, input, first.key).expect(403);
    await db.session.update({ where: { id: admin.session.id }, data: { reauthenticatedAt: new Date() } });
    await db.rolePermission.deleteMany({ where: { roleId: admin.role.id, permission: { code: 'platform:admin' } } });
    await restore(admin, 'POSITION', first.sourceId, input, first.key).expect(403);
    expect(await db.position.findMany({ where: { organizationId: admin.home.id }, orderBy: { id: 'asc' } }))
      .toEqual([existing, ...replacements.map(({ replacement }) => replacement)].sort((a, b) => a.id.localeCompare(b.id)));
    expect(await db.positionRole.findMany({ where: { positionId: existing.id } })).toEqual([existingRole]);
    expect(await db.userPosition.findMany({ where: { positionId: existing.id } })).toEqual([existingAppointment]);
  });

  it('creates an unprivileged disabled replacement position without changing old tenant, role or appointment facts', async () => {
    const admin = await administrator();
    const old = await organization();
    const oldDepartment = await db.department.create({ data: { organizationId: old.id, code: randomUUID(), name: 'Historical department' } });
    const source = await db.position.create({ data: { organizationId: old.id, departmentId: oldDepartment.id, code: randomUUID(), name: 'Historical position', status: 'DISABLED', configurationRequired: true } });
    await db.organization.update({ where: { id: old.id }, data: { status: 'DISABLED', deletedAt: new Date() } });
    const targetDepartment = await db.department.create({ data: { organizationId: admin.home.id, code: randomUUID(), name: 'Replacement department' } });
    const input = { expectedVersion: 1, targetOrganizationId: admin.home.id, targetDepartmentId: targetDepartment.id };
    const key = randomUUID();
    const response = await restore(admin, 'POSITION', source.id, input, key).expect(201);
    expect(response.body).toMatchObject({ id: source.id, originalOrganizationId: old.id, targetOrganizationId: admin.home.id, status: 'DISABLED', version: 2 });
    const replacementId = response.body.replacementId as string;
    expect(replacementId).not.toBe(source.id);
    expect(await db.position.findUniqueOrThrow({ where: { id: replacementId } })).toMatchObject({ organizationId: admin.home.id, departmentId: targetDepartment.id, code: source.code, name: source.name, status: 'DISABLED', configurationRequired: false, categoryId: null });
    expect(await db.position.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({ organizationId: old.id, departmentId: oldDepartment.id, configurationRequired: false, status: 'DISABLED', version: 2 });
    expect(await db.positionRole.count({ where: { positionId: replacementId } })).toBe(0);
    expect(await db.userPosition.count({ where: { positionId: replacementId } })).toBe(0);
    expect((await restore(admin, 'POSITION', source.id, input, key).expect(201)).body).toEqual(response.body);
    expect(await db.$queryRaw`SELECT source_orgid, replacement_id, replacement_orgid FROM administrative_configuration_links WHERE kind = 'POSITION' AND source_id = ${source.id}::uuid`)
      .toEqual([{ source_orgid: old.id, replacement_id: replacementId, replacement_orgid: admin.home.id }]);
  });
});
