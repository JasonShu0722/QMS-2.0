import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Client } from 'pg';
import { setTimeout } from 'node:timers/promises';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AdministrativeLifecycleRegistry } from '../../src/common/security/administrative-lifecycle.registry.js';
import type { AdministrativeLifecycleImpact } from '../../src/common/security/administrative-lifecycle.types.js';
import { OrganizationForceDeleteService } from '../../src/modules/organization/organization-force-delete.service.js';
import { OrganizationForceDeleteController } from '../../src/modules/organization/organization-force-delete.controller.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { PositionOnboardingService } from '../../src/modules/organization/position-onboarding.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AuthenticatedGuard } from '../../src/common/guards/authenticated.guard.js';
import { CsrfGuard } from '../../src/modules/identity/csrf.guard.js';
import { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import { OrganizationScopeService } from '../../src/modules/organization/organization-scope.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

// Neutral sibling effects exercise only command dispatch/atomicity, not final domain acceptance.
describe('REQ0031 C organization command: real HTTP/PostgreSQL, neutral sibling effects', () => {
  let app: INestApplication;
  let db: PrismaService;
  let commands: OrganizationForceDeleteService;
  let sessions: SessionService;
  let registry: AdministrativeLifecycleRegistry;
  let failEffect = false;
  const impacts: AdministrativeLifecycleImpact[] = [];
  const calls: string[] = [];
  const body = { expectedVersion: 1, confirmed: true as const };
  const trace = () => randomUUID();

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!isDisposableLoopbackPostgres(url) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
      throw new Error('Requires disposable loopback PostgreSQL and explicit QMS_DISPOSABLE_TEST_DB=true; remote databases and preview 55440 are forbidden.');
    }
    registry = new AdministrativeLifecycleRegistry();
    for (const module of ['workflow', 'platform-configuration', 'identity'] as const) registry.register({ module, async apply(_tx, _actor, impact) {
      calls.push(module);
      if (module === 'workflow') impacts.push(impact);
      if (module === 'platform-configuration' && failEffect) throw new Error('TEST_EFFECT_ROLLBACK');
      return { module, changed: 0, pendingConfiguration: 0 };
    } });
    registry.seal();
    app = (await Test.createTestingModule({ controllers: [OrganizationForceDeleteController], providers: [
      PrismaService, AuditLogService, AdminMutationService, OrganizationForceDeleteService, SessionService,
      AuthorizationService, OrganizationScopeService, { provide: AdministrativeLifecycleRegistry, useValue: registry },
      { provide: APP_GUARD, useClass: AuthenticatedGuard }, { provide: APP_GUARD, useClass: CsrfGuard },
    ] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    db = app.get(PrismaService);
    commands = app.get(OrganizationForceDeleteService);
    sessions = app.get(SessionService);
    expect(await db.$queryRaw`SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261028230000_administrative_lifecycle' AND finished_at IS NOT NULL`).toHaveLength(1);
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => { impacts.length = 0; calls.length = 0; failEffect = false; });

  async function organization(parentId?: string, type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    return db.organization.create({ data: { code: randomUUID(), name: 'Original organization', type, parentId } });
  }
  async function administrator(home: { id: string }, marker = true, accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const user = await db.user.create({ data: { organizationId: home.id, username: randomUUID(), accountType, passwordHash: 'test-only' } });
    const codes = ['organization:force-delete', 'organization:departments:force-delete', ...(marker ? ['platform:admin'] : [])];
    const permissions = await Promise.all(codes.map(code => db.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    const role = await db.role.create({ data: { organizationId: home.id, code: randomUUID(), name: 'admin', permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    await db.userRole.create({ data: { organizationId: home.id, userId: user.id, roleId: role.id } });
    const token = await sessions.create(user.id, db, { mfaVerified: true, reauthenticated: true });
    const session = (await sessions.resolve(token))!;
    return { user, role, token, actor: { id: user.id, organizationId: home.id, accountType, sessionId: session.id } as AdminActor,
      cookie: `qms_session=${token}; qms_csrf=command-csrf` };
  }
  async function fixture() {
    const home = await organization();
    const admin = await administrator(home);
    const target = await organization(home.id);
    let confirmed: Awaited<ReturnType<typeof confirmation>> | undefined;
    return { home, admin, target, remove: async (key = randomUUID(), version = 1) => {
      confirmed ??= await confirmation(admin.actor, target.id);
      return commands.forceDeleteOrganization(admin.actor, target.id, { ...confirmed, expectedVersion: version }, trace(), key);
    } };
  }
  async function confirmation(actor: AdminActor, org: string, dep?: string) {
    const preview = dep ? await commands.previewDepartment(actor, org, dep) : await commands.previewOrganization(actor, org);
    return { expectedVersion: preview.version, confirmed: true as const, previewToken: preview.previewToken };
  }
  async function removeOrganization(actor: AdminActor, org: string, key: string) {
    return commands.forceDeleteOrganization(actor, org, await confirmation(actor, org), trace(), key);
  }
  async function removeDepartment(actor: AdminActor, org: string, dep: string, key: string) {
    return commands.forceDeleteDepartment(actor, org, dep, await confirmation(actor, org, dep), trace(), key);
  }
  const path = (org: string, department?: string) => `/api/v1/organizations/${org}${department ? `/departments/${department}` : ''}/force-delete`;
  async function department(org: string, parentId?: string) {
    return db.department.create({ data: { organizationId: org, parentId, code: randomUUID(), name: 'Original department' } });
  }
  async function position(org: string, dep: string) {
    return db.position.create({ data: { organizationId: org, departmentId: dep, code: randomUUID(), name: 'Preserved position' } });
  }

  it.each(['child', 'assignment'] as const)('rejects a stale preview after a real %s insertion without target version changes, then accepts one refreshed confirmation', async change => {
    const f = await fixture(); const dep = await department(f.target.id); const pos = await position(f.target.id, dep.id);
    const member = await administrator(f.target);
    const preview = await request(app.getHttpServer()).get(path(f.target.id, dep.id)).set('Cookie', f.admin.cookie).expect(200);
    const stale = { ...body, previewToken: preview.body.previewToken };
    let child: Awaited<ReturnType<typeof department>> | undefined;
    let assignment: Awaited<ReturnType<typeof db.userPosition.create>> | undefined;
    if (change === 'child') {
      const audit = app.get(AuditLogService);
      const structure = new OrganizationService(db, app.get(AdminMutationService), audit, new PositionOnboardingService(db, audit));
      const created = await structure.createDepartment(f.admin.actor, f.target.id, { code: randomUUID(), name: 'New child', parentId: dep.id }, trace(), randomUUID());
      child = (await db.department.findUnique({ where: { id: created.id } }))!;
    } else {
      assignment = await db.userPosition.create({ data: { organizationId: f.target.id, userId: member.user.id, positionId: pos.id } });
    }
    expect(await db.department.findUnique({ where: { id: dep.id } })).toEqual(dep);
    const key = randomUUID();
    await request(app.getHttpServer()).post(path(f.target.id, dep.id)).set('Cookie', f.admin.cookie)
      .set('x-csrf-token', 'command-csrf').set('Idempotency-Key', key).send(stale).expect(409);
    expect(calls).toEqual([]);
    expect(await db.department.findUnique({ where: { id: dep.id } })).toEqual(dep);
    expect(await db.position.findUnique({ where: { id: pos.id } })).toEqual(pos);
    if (child) expect(await db.department.findUnique({ where: { id: child.id } })).toEqual(child);
    if (assignment) expect(await db.userPosition.findUnique({ where: { id: assignment.id } })).toEqual(assignment);
    expect(await db.adminMutation.count({ where: { key } })).toBe(0);
    expect(await db.$queryRaw`SELECT id FROM administrative_deletions WHERE entity_id = ${dep.id}::uuid`).toEqual([]);
    const refreshed = await request(app.getHttpServer()).get(path(f.target.id, dep.id)).set('Cookie', f.admin.cookie).expect(200);
    expect(refreshed.body.previewToken).toMatch(/^[a-f0-9]{64}$/);
    expect(refreshed.body.previewToken).not.toBe(preview.body.previewToken);
    await request(app.getHttpServer()).post(path(f.target.id, dep.id)).set('Cookie', f.admin.cookie)
      .set('x-csrf-token', 'command-csrf').set('Idempotency-Key', key).send({ ...body, previewToken: refreshed.body.previewToken }).expect(201);
    expect(calls).toEqual(['workflow', 'platform-configuration', 'identity']);
  });

  it.each(['department', 'position', 'user-security', 'assignment', 'binding', 'minister'] as const)('binds existing %s reference versions/values privately even when counts stay equal', async change => {
    const f = await fixture(); const dep = await department(f.target.id); const child = await department(f.target.id, dep.id);
    const pos = await position(f.target.id, dep.id); const member = await administrator(f.target);
    const assignment = await db.userPosition.create({ data: { organizationId: f.target.id, userId: member.user.id, positionId: pos.id } });
    const binding = randomUUID(), scope = randomUUID();
    await db.$executeRaw`INSERT INTO department_management_bindings (id,organization_id,department_id,responsibility,position_id,created_by,updated_by)
      VALUES (${binding}::uuid,${f.target.id}::uuid,${dep.id}::uuid,'MINISTER',${pos.id}::uuid,${f.admin.user.id}::uuid,${f.admin.user.id}::uuid)`;
    await db.$executeRaw`INSERT INTO department_minister_scopes (id,organization_id,department_id,section_department_id,minister_assignment_id,created_by,updated_by)
      VALUES (${scope}::uuid,${f.target.id}::uuid,${dep.id}::uuid,${child.id}::uuid,${assignment.id}::uuid,${f.admin.user.id}::uuid,${f.admin.user.id}::uuid)`;
    const before = await commands.previewDepartment(f.admin.actor, f.target.id, dep.id);
    expect(await commands.previewDepartment(f.admin.actor, f.target.id, dep.id)).toEqual(before);
    expect(Object.keys(before).sort()).toEqual(['code', 'counts', 'id', 'kind', 'name', 'previewToken', 'retainedHistory', 'version']);
    expect(JSON.stringify(before)).not.toContain(member.user.id);
    expect(JSON.stringify(before)).not.toContain(assignment.id);
    switch (change) {
      case 'department': await db.department.update({ where: { id: child.id }, data: { version: { increment: 1 } } }); break;
      case 'position': await db.position.update({ where: { id: pos.id }, data: { roleVersion: { increment: 1 } } }); break;
      case 'user-security': await db.user.update({ where: { id: member.user.id }, data: { securityVersion: { increment: 1 } } }); break;
      case 'assignment': await db.userPosition.update({ where: { id: assignment.id }, data: { endedAt: new Date(Date.now() + 3600_000) } }); break;
      case 'binding': await db.$executeRaw`UPDATE department_management_bindings SET version = version + 1 WHERE id = ${binding}::uuid`; break;
      case 'minister': await db.$executeRaw`UPDATE department_minister_scopes SET version = version + 1 WHERE id = ${scope}::uuid`; break;
    }
    const after = await commands.previewDepartment(f.admin.actor, f.target.id, dep.id);
    expect(after.counts).toEqual(before.counts);
    expect(after.version).toBe(before.version);
    expect(after.previewToken).not.toBe(before.previewToken);
    await expect(commands.forceDeleteDepartment(f.admin.actor, f.target.id, dep.id,
      { ...body, previewToken: before.previewToken }, trace(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(calls).toEqual([]);
    expect(await db.department.findUnique({ where: { id: dep.id } })).toEqual(dep);
    expect(await db.$queryRaw`SELECT id FROM administrative_deletions WHERE entity_id = ${dep.id}::uuid`).toEqual([]);
  });

  it('binds the real actor, scope, kind and target, and includes token changes in the existing mutation digest', async () => {
    const f = await fixture(); const other = await administrator(f.home); const dep = await department(f.target.id);
    const confirmed = await confirmation(f.admin.actor, f.target.id);
    const scopedActor = { ...f.admin.actor, scopeOrganizationId: f.target.id };
    const scoped = await confirmation(scopedActor, f.target.id);
    expect(scoped.previewToken).not.toBe(confirmed.previewToken);
    const secondTarget = await organization(f.home.id);
    for (const [actor, org, departmentId] of [[other.actor, f.target.id, undefined], [scopedActor, f.target.id, undefined],
      [f.admin.actor, secondTarget.id, undefined], [f.admin.actor, f.target.id, dep.id]] as const) {
      const command = departmentId ? commands.forceDeleteDepartment(actor, org, departmentId, confirmed, trace(), randomUUID())
        : commands.forceDeleteOrganization(actor, org, confirmed, trace(), randomUUID());
      await expect(command).rejects.toMatchObject({ status: 409 });
    }
    const key = randomUUID();
    const result = await commands.forceDeleteOrganization(f.admin.actor, f.target.id, confirmed, trace(), key);
    expect(result.previewToken).toBe(confirmed.previewToken);
    expect(await commands.forceDeleteOrganization(f.admin.actor, f.target.id, confirmed, trace(), key)).toEqual(result);
    await expect(commands.forceDeleteOrganization(scopedActor, f.target.id, confirmed, trace(), key))
      .rejects.toMatchObject({ status: 409, response: { code: 'IDEMPOTENCY_REPLAY' } });
    await expect(commands.forceDeleteOrganization(f.admin.actor, f.target.id, { ...confirmed, previewToken: scoped.previewToken }, trace(), key))
      .rejects.toMatchObject({ status: 409, response: { code: 'IDEMPOTENCY_REPLAY' } });
    expect(calls).toEqual(['workflow', 'platform-configuration', 'identity']);
    expect(await db.$queryRaw`SELECT id FROM administrative_deletions WHERE entity_id = ${f.target.id}::uuid`).toHaveLength(1);
  });

  it('recollects references committed while waiting for the lifecycle lock, rejecting the old baseline before any effect', async () => {
    const f = await fixture(); const dep = await department(f.target.id);
    const confirmed = await confirmation(f.admin.actor, f.target.id, dep.id);
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('administrative-lifecycle',0))");
      pending = commands.forceDeleteDepartment(f.admin.actor, f.target.id, dep.id, confirmed, trace(), randomUUID());
      const outcome = pending.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
      let waiting = false;
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        await blocker.query('SELECT pg_stat_clear_snapshot()');
        const result = await blocker.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event = 'advisory' AND query LIKE '%administrative-lifecycle%'");
        if (result.rowCount) { waiting = true; break; }
        await setTimeout(20);
      }
      expect(waiting).toBe(true);
      const childId = randomUUID();
      await blocker.query('INSERT INTO departments (id, organization_id, parent_id, code, name, updated_at) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,CURRENT_TIMESTAMP)',
        [childId, f.target.id, dep.id, randomUUID(), 'Committed while waiting']);
      await blocker.query('COMMIT');
      expect((await outcome).error).toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
      expect(calls).toEqual([]);
      expect(await db.department.findUnique({ where: { id: dep.id } })).toEqual(dep);
      expect(await db.department.findUnique({ where: { id: childId } })).toMatchObject({ status: 'ACTIVE', parentId: dep.id, version: 1 });
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      await pending?.catch(() => undefined);
    }
  });

  it.each(['version', 'same-count-replacement'] as const)('binds direct child organizations by ID and version: %s', async change => {
    const f = await fixture(); const child = await organization(f.target.id);
    const before = await commands.previewOrganization(f.admin.actor, f.target.id);
    if (change === 'version') await db.organization.update({ where: { id: child.id }, data: { version: { increment: 1 } } });
    else {
      await db.organization.update({ where: { id: child.id }, data: { parentId: f.home.id, version: { increment: 1 } } });
      await organization(f.target.id);
    }
    const after = await commands.previewOrganization(f.admin.actor, f.target.id);
    expect(after.counts).toEqual(before.counts);
    expect(after.version).toBe(before.version);
    expect(after.previewToken).not.toBe(before.previewToken);
    await expect(commands.forceDeleteOrganization(f.admin.actor, f.target.id, { ...body, previewToken: before.previewToken }, trace(), randomUUID()))
      .rejects.toMatchObject({ status: 409 });
    expect(calls).toEqual([]);
    expect(await db.organization.findUnique({ where: { id: f.target.id } })).toEqual(f.target);
  });

  it('exposes preview and authenticated POST with server-only impact, retained identity and actor-home receipt', async () => {
    const f = await fixture();
    const preview = await request(app.getHttpServer()).get(path(f.target.id)).set('Cookie', f.admin.cookie).expect(200);
    expect(preview.body).toMatchObject({ kind: 'ORGANIZATION', id: f.target.id, code: f.target.code, name: f.target.name, version: 1,
      counts: { users: 0, departments: 0, positions: 0 }, retainedHistory: expect.any(Array) });
    const key = randomUUID();
    const confirmed = { ...body, previewToken: preview.body.previewToken };
    const response = await request(app.getHttpServer()).post(path(f.target.id)).set('Cookie', f.admin.cookie)
      .set('x-csrf-token', 'command-csrf').set('Idempotency-Key', key).send(confirmed).expect(201);
    expect(response.body).toMatchObject({ ...preview.body, version: 2, deletedAt: expect.any(String) });
    expect(calls).toEqual(['workflow', 'platform-configuration', 'identity']);
    expect(impacts[0]).toMatchObject({ entityId: f.target.id, organizationId: f.target.id, receiptOrganizationId: f.home.id });
    expect(await db.adminMutation.findFirst({ where: { key } })).toMatchObject({ actorUserId: f.admin.user.id, organizationId: f.home.id, response: { value: response.body } });
    expect(await commands.forceDeleteOrganization(f.admin.actor, f.target.id, confirmed, trace(), key)).toEqual(response.body);
    expect(calls).toHaveLength(3);
    await expect(f.remove(randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  it('retains users/grants/logs/receipts and non-initialization history while detaching children and preserving original snapshot', async () => {
    const f = await fixture();
    const child = await organization(f.target.id);
    const grandchild = await organization(child.id);
    const dep = await department(f.target.id);
    const pos = await position(f.target.id, dep.id);
    const member = await administrator(f.target);
    const assignment = await db.userPosition.create({ data: { organizationId: f.target.id, userId: member.user.id, positionId: pos.id } });
    const event = await db.auditEvent.create({ data: { organizationId: f.target.id, actorUserId: member.user.id, resourceType: 'History', action: 'OLD_HISTORY', outcome: 'SUCCESS', traceId: trace() } });
    const receipt = await db.adminMutation.create({ data: { actorUserId: member.user.id, organizationId: f.target.id, key: randomUUID(), action: 'OLD_HISTORY', requestDigest: 'old', response: { value: 'keep' } } });
    const result = await f.remove();
    expect(result.counts).toMatchObject({ users: 1, departments: 1, positions: 1, assignments: 1 });
    expect(await db.organization.findUnique({ where: { id: f.target.id } })).toMatchObject({ status: 'DISABLED', deletedAt: expect.any(Date), code: `DELETED.${f.target.id.replaceAll('-', '')}`, version: 2 });
    expect(await db.organization.findUnique({ where: { id: child.id } })).toMatchObject({ parentId: null, status: 'DISABLED', configurationRequired: true, deletedAt: null, version: 2 });
    expect(await db.organization.findUnique({ where: { id: grandchild.id } })).toMatchObject({ parentId: child.id, deletedAt: null, version: 1 });
    expect(await db.department.findUnique({ where: { id: dep.id } })).toMatchObject({ status: 'DISABLED', configurationRequired: true, deletedAt: null });
    expect(await db.position.findUnique({ where: { id: pos.id } })).toMatchObject({ status: 'DISABLED', configurationRequired: true, departmentId: dep.id, deletedAt: null });
    expect(await db.userPosition.findUnique({ where: { id: assignment.id } })).toMatchObject({ endedAt: expect.any(Date) });
    expect(await db.user.findUnique({ where: { id: member.user.id } })).toMatchObject({ organizationId: f.target.id, deletedAt: null });
    expect(await db.role.findUnique({ where: { id: member.role.id } })).not.toBeNull();
    expect(await db.userRole.count({ where: { userId: member.user.id } })).toBe(1);
    expect(await db.auditEvent.findUnique({ where: { id: event.id } })).toEqual(event);
    expect(await db.adminMutation.findUnique({ where: { id: receipt.id } })).toEqual(receipt);
    const [snapshot] = await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM administrative_deletions WHERE entity_id = ${f.target.id}::uuid`;
    expect(snapshot).toMatchObject({ scope_organization_id: f.home.id, original_organization_id: f.target.id,
      original_identity: { code: f.target.code, name: f.target.name, parentId: f.home.id, type: 'INTERNAL' } });
    expect(JSON.stringify(snapshot)).not.toContain('passwordHash');
    expect((await db.organization.create({ data: { code: f.target.code, name: f.target.name, type: 'INTERNAL', parentId: f.home.id } })).id).not.toBe(f.target.id);
    // Neutral identity effect does not prove credential revocation/pending users; parent App matrix owns that assertion.
  });

  it('previews and deletes a server-detached pending child without reparenting or reactivation, retaining descendants/users/history', async () => {
    const f = await fixture(); const child = await organization(f.target.id); const grandchild = await organization(child.id);
    const dep = await department(child.id); const pos = await position(child.id, dep.id); const member = await administrator(child);
    const assignment = await db.userPosition.create({ data: { organizationId: child.id, userId: member.user.id, positionId: pos.id } });
    const event = await db.auditEvent.create({ data: { organizationId: child.id, actorUserId: member.user.id, resourceType: 'History', action: 'OLD_HISTORY', outcome: 'SUCCESS', traceId: trace() } });
    const receipt = await db.adminMutation.create({ data: { actorUserId: member.user.id, organizationId: child.id, key: randomUUID(), action: 'OLD_HISTORY', requestDigest: 'old', response: { value: 'keep' } } });
    const stale = await confirmation(f.admin.actor, child.id);
    await f.remove();
    const detached = await db.organization.findUniqueOrThrow({ where: { id: child.id } });
    expect(detached).toMatchObject({ parentId: null, status: 'DISABLED', configurationRequired: true, deletedAt: null, version: 2 });
    expect(await db.organization.findUnique({ where: { id: grandchild.id } })).toEqual(grandchild);
    const preview = await request(app.getHttpServer()).get(path(child.id)).set('Cookie', f.admin.cookie).expect(200);
    expect(preview.body).toMatchObject({ id: child.id, version: detached.version,
      counts: { organizations: 2, users: 1, departments: 1, positions: 1, assignments: 1 } });
    expect(await db.organization.findUnique({ where: { id: child.id } })).toEqual(detached);
    const key = randomUUID();
    await expect(commands.forceDeleteOrganization(f.admin.actor, child.id, stale, trace(), key))
      .rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(await db.adminMutation.count({ where: { key } })).toBe(0);
    const confirmed = { expectedVersion: preview.body.version, confirmed: true as const, previewToken: preview.body.previewToken };
    const response = await request(app.getHttpServer()).post(path(child.id)).set('Cookie', f.admin.cookie)
      .set('x-csrf-token', 'command-csrf').set('Idempotency-Key', key).send(confirmed).expect(201);
    expect(response.body).toMatchObject({ id: child.id, version: 3, deletedAt: expect.any(String) });
    expect(await commands.forceDeleteOrganization(f.admin.actor, child.id, confirmed, trace(), key)).toEqual(response.body);
    expect(await db.organization.findUnique({ where: { id: child.id } })).toMatchObject({ parentId: null, status: 'DISABLED', configurationRequired: false, deletedAt: expect.any(Date), version: 3 });
    expect(await db.organization.findUnique({ where: { id: grandchild.id } })).toMatchObject({ parentId: null, status: 'DISABLED', configurationRequired: true, deletedAt: null, version: 2 });
    expect(await db.department.findUnique({ where: { id: dep.id } })).toMatchObject({ organizationId: child.id, status: 'DISABLED', configurationRequired: true, deletedAt: null });
    expect(await db.position.findUnique({ where: { id: pos.id } })).toMatchObject({ organizationId: child.id, departmentId: dep.id, status: 'DISABLED', configurationRequired: true, deletedAt: null });
    expect(await db.userPosition.findUnique({ where: { id: assignment.id } })).toMatchObject({ endedAt: expect.any(Date) });
    expect(await db.user.findUnique({ where: { id: member.user.id } })).toEqual(member.user);
    expect(await db.role.findUnique({ where: { id: member.role.id } })).toEqual(member.role);
    expect(await db.userRole.count({ where: { userId: member.user.id } })).toBe(1);
    expect(await db.auditEvent.findUnique({ where: { id: event.id } })).toEqual(event);
    expect(await db.adminMutation.findUnique({ where: { id: receipt.id } })).toEqual(receipt);
    expect(await db.$queryRaw`SELECT original_organization_id, original_identity FROM administrative_deletions WHERE entity_id = ${child.id}::uuid`)
      .toEqual([{ original_organization_id: child.id, original_identity: { code: child.code, name: child.name, parentId: null, type: 'INTERNAL' } }]);
    expect(await db.organization.findUnique({ where: { id: f.home.id } })).toEqual(f.home);
    expect(calls).toEqual(['workflow', 'platform-configuration', 'identity', 'workflow', 'platform-configuration', 'identity']);
  });

  it('previews and deletes a surviving pending department in its deleted internal organization without restoring or moving history', async () => {
    const f = await fixture(); const dep = await department(f.target.id); const child = await department(f.target.id, dep.id);
    const pos = await position(f.target.id, dep.id); const childPos = await position(f.target.id, child.id);
    const member = await administrator(f.target);
    const assignment = await db.userPosition.create({ data: { organizationId: f.target.id, userId: member.user.id, positionId: pos.id } });
    const event = await db.auditEvent.create({ data: { organizationId: f.target.id, actorUserId: member.user.id, resourceType: 'History', action: 'OLD_HISTORY', outcome: 'SUCCESS', traceId: trace() } });
    const receipt = await db.adminMutation.create({ data: { actorUserId: member.user.id, organizationId: f.target.id, key: randomUUID(), action: 'OLD_HISTORY', requestDigest: 'old', response: { value: 'keep' } } });
    const stale = await confirmation(f.admin.actor, f.target.id, dep.id);
    await f.remove();
    const deletedOrg = await db.organization.findUniqueOrThrow({ where: { id: f.target.id } });
    expect(deletedOrg).toMatchObject({ status: 'DISABLED', deletedAt: expect.any(Date) });
    const pending = await db.department.findUniqueOrThrow({ where: { id: dep.id } });
    expect(pending).toMatchObject({ organizationId: f.target.id, status: 'DISABLED', configurationRequired: true, deletedAt: null, version: 2 });
    const pendingChildPos = await db.position.findUniqueOrThrow({ where: { id: childPos.id } });
    expect(pendingChildPos).toMatchObject({ departmentId: child.id, status: 'DISABLED', configurationRequired: true, deletedAt: null });
    const preview = await request(app.getHttpServer()).get(path(f.target.id, dep.id)).set('Cookie', f.admin.cookie).expect(200);
    expect(preview.body).toMatchObject({ id: dep.id, version: pending.version, counts: { departments: 2, positions: 1, assignments: 0 } });
    const key = randomUUID();
    await expect(commands.forceDeleteDepartment(f.admin.actor, f.target.id, dep.id, stale, trace(), key))
      .rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(await db.adminMutation.count({ where: { key } })).toBe(0);
    const confirmed = { expectedVersion: preview.body.version, confirmed: true as const, previewToken: preview.body.previewToken };
    const response = await request(app.getHttpServer()).post(path(f.target.id, dep.id)).set('Cookie', f.admin.cookie)
      .set('x-csrf-token', 'command-csrf').set('Idempotency-Key', key).send(confirmed).expect(201);
    expect(response.body).toMatchObject({ id: dep.id, version: 3, deletedAt: expect.any(String) });
    expect(await commands.forceDeleteDepartment(f.admin.actor, f.target.id, dep.id, confirmed, trace(), key)).toEqual(response.body);
    await expect(commands.previewDepartment(f.admin.actor, f.target.id, dep.id)).rejects.toMatchObject({ status: 404 });
    await expect(commands.forceDeleteDepartment(f.admin.actor, f.target.id, dep.id, confirmed, trace(), randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(await db.department.findUnique({ where: { id: dep.id } })).toMatchObject({ organizationId: f.target.id, deletedAt: expect.any(Date), configurationRequired: false, version: 3 });
    expect(await db.department.findUnique({ where: { id: child.id } })).toMatchObject({ organizationId: f.target.id, parentId: null, status: 'DISABLED', configurationRequired: true, deletedAt: null, version: 3 });
    expect(await db.position.findUnique({ where: { id: pos.id } })).toMatchObject({ organizationId: f.target.id, departmentId: dep.id, status: 'DISABLED', configurationRequired: true, deletedAt: null, version: 3 });
    expect(await db.position.findUnique({ where: { id: childPos.id } })).toEqual(pendingChildPos);
    expect(await db.userPosition.findUnique({ where: { id: assignment.id } })).toMatchObject({ organizationId: f.target.id, endedAt: expect.any(Date) });
    expect(await db.user.findUnique({ where: { id: member.user.id } })).toEqual(member.user);
    expect(await db.auditEvent.findUnique({ where: { id: event.id } })).toEqual(event);
    expect(await db.adminMutation.findUnique({ where: { id: receipt.id } })).toEqual(receipt);
    expect(await db.organization.findUnique({ where: { id: f.target.id } })).toEqual(deletedOrg);
    expect(await db.$queryRaw`SELECT original_organization_id, original_identity FROM administrative_deletions WHERE entity_id = ${dep.id}::uuid`)
      .toEqual([{ original_organization_id: f.target.id, original_identity: { code: dep.code, name: dep.name, parentId: null, organizationId: f.target.id } }]);
    expect(calls).toEqual(['workflow', 'platform-configuration', 'identity', 'workflow', 'platform-configuration', 'identity']);
  });

  it('deletes only the department, ends only direct-position appointments and disables only related management bindings/scopes', async () => {
    const f = await fixture(); const dep = await department(f.target.id); const child = await department(f.target.id, dep.id);
    const other = await department(f.target.id); const pos = await position(f.target.id, dep.id); const otherPos = await position(f.target.id, other.id);
    const member = await administrator(f.target);
    const assignment = await db.userPosition.create({ data: { organizationId: f.target.id, userId: member.user.id, positionId: pos.id } });
    const untouched = await db.userPosition.create({ data: { organizationId: f.target.id, userId: member.user.id, positionId: otherPos.id } });
    const binding = randomUUID(), otherBinding = randomUUID(), scope = randomUUID();
    for (const [id, departmentId, positionId] of [[binding, dep.id, pos.id], [otherBinding, other.id, otherPos.id]]) await db.$executeRaw`INSERT INTO department_management_bindings
      (id,organization_id,department_id,responsibility,position_id,created_by,updated_by)
      VALUES (${id}::uuid,${f.target.id}::uuid,${departmentId}::uuid,'MINISTER',${positionId}::uuid,${f.admin.user.id}::uuid,${f.admin.user.id}::uuid)`;
    await db.$executeRaw`INSERT INTO department_minister_scopes (id,organization_id,department_id,section_department_id,minister_assignment_id,created_by,updated_by)
      VALUES (${scope}::uuid,${f.target.id}::uuid,${dep.id}::uuid,${child.id}::uuid,${assignment.id}::uuid,${f.admin.user.id}::uuid,${f.admin.user.id}::uuid)`;
    const preview = await request(app.getHttpServer()).get(path(f.target.id, dep.id)).set('Cookie', f.admin.cookie).expect(200);
    expect(preview.body).toMatchObject({ kind: 'DEPARTMENT', counts: { users: 1, departments: 2, positions: 1, assignments: 1, managementBindings: 1, ministerScopes: 1 } });
    const key = randomUUID();
    const confirmed = { ...body, previewToken: preview.body.previewToken };
    const response = await request(app.getHttpServer()).post(path(f.target.id, dep.id)).set('Cookie', f.admin.cookie)
      .set('x-csrf-token', 'command-csrf').set('Idempotency-Key', key).send(confirmed).expect(201);
    const result = response.body;
    expect(await commands.forceDeleteDepartment(f.admin.actor, f.target.id, dep.id, confirmed, trace(), key)).toEqual(result);
    expect(await db.department.findUnique({ where: { id: dep.id } })).toMatchObject({ deletedAt: expect.any(Date), code: `DELETED.${dep.id.replaceAll('-', '')}`, status: 'DISABLED', version: 2 });
    expect(await db.department.findUnique({ where: { id: child.id } })).toMatchObject({ parentId: null, status: 'DISABLED', configurationRequired: true, deletedAt: null });
    expect(await db.position.findUnique({ where: { id: pos.id } })).toMatchObject({ departmentId: dep.id, status: 'DISABLED', configurationRequired: true, deletedAt: null });
    expect(await db.userPosition.findUnique({ where: { id: assignment.id } })).toMatchObject({ endedAt: expect.any(Date) });
    expect(await db.userPosition.findUnique({ where: { id: untouched.id } })).toEqual(untouched);
    expect(await db.position.findUnique({ where: { id: otherPos.id } })).toEqual(otherPos);
    expect(await db.user.findUnique({ where: { id: member.user.id } })).toEqual(member.user);
    expect(await db.organization.findUnique({ where: { id: f.target.id } })).toEqual(f.target);
    expect(await db.$queryRaw`SELECT status FROM department_management_bindings WHERE id = ${binding}::uuid`).toEqual([{ status: 'DISABLED' }]);
    expect(await db.$queryRaw`SELECT status FROM department_management_bindings WHERE id = ${otherBinding}::uuid`).toEqual([{ status: 'ACTIVE' }]);
    expect(await db.$queryRaw`SELECT status FROM department_minister_scopes WHERE id = ${scope}::uuid`).toEqual([{ status: 'DISABLED' }]);
    expect(impacts[0]).toMatchObject({ userIds: [member.user.id], positionIds: [pos.id], departmentIds: expect.arrayContaining([dep.id, child.id]) });
    expect((await db.department.create({ data: { organizationId: f.target.id, code: dep.code, name: dep.name } })).id).not.toBe(dep.id);
    await expect(removeDepartment(f.admin.actor, f.home.id, dep.id, randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  it('requires a new department confirmation when another surviving appointment changes user availability', async () => {
    const f = await fixture(), removed = await department(f.target.id), surviving = await department(f.target.id);
    const member = await administrator(f.target), removedPosition = await position(f.target.id, removed.id);
    await db.userPosition.create({ data: { organizationId: f.target.id, userId: member.user.id, positionId: removedPosition.id } });
    const before = await commands.previewDepartment(f.admin.actor, f.target.id, removed.id);
    const survivingPosition = await position(f.target.id, surviving.id);
    await db.userPosition.create({ data: { organizationId: f.target.id, userId: member.user.id, positionId: survivingPosition.id } });
    const after = await commands.previewDepartment(f.admin.actor, f.target.id, removed.id);
    expect(after.counts).toEqual(before.counts);
    expect(after.previewToken).not.toBe(before.previewToken);
    await expect(commands.forceDeleteDepartment(f.admin.actor, f.target.id, removed.id,
      { ...body, expectedVersion: before.version, previewToken: before.previewToken }, trace(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(await db.department.findUniqueOrThrow({ where: { id: removed.id } })).toMatchObject({ deletedAt: null, version: 1 });
    await commands.forceDeleteDepartment(f.admin.actor, f.target.id, removed.id,
      { ...body, expectedVersion: after.version, previewToken: after.previewToken }, trace(), randomUUID());
    expect(impacts.at(-1)).toMatchObject({ userIds: [member.user.id], unavailableUserIds: [] });
  });

  it('requires a real internal marker, independent permission, RecentAuth, and rejects supplier targets/root/self-home', async () => {
    const f = await fixture(); const ordinary = await administrator(f.home, false);
    const confirmed = await confirmation(f.admin.actor, f.target.id);
    await expect(commands.forceDeleteOrganization(ordinary.actor, f.target.id, confirmed, trace(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(commands.previewOrganization(f.admin.actor, f.home.id)).rejects.toMatchObject({ status: 409 });
    await expect(commands.forceDeleteOrganization(f.admin.actor, f.home.id, confirmed, trace(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const root = await organization();
    await expect(commands.previewOrganization(f.admin.actor, root.id)).rejects.toMatchObject({ status: 409 });
    await expect(commands.forceDeleteOrganization(f.admin.actor, root.id, confirmed, trace(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await db.organization.update({ where: { id: root.id }, data: { status: 'DISABLED' } });
    await expect(commands.previewOrganization(f.admin.actor, root.id)).rejects.toMatchObject({ status: 409 });
    await expect(commands.forceDeleteOrganization(f.admin.actor, root.id, confirmed, trace(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const supplier = await organization(f.home.id, 'SUPPLIER');
    await expect(commands.forceDeleteOrganization(f.admin.actor, supplier.id, confirmed, trace(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const supplierDep = await department(supplier.id);
    await expect(commands.previewDepartment(f.admin.actor, supplier.id, supplierDep.id)).rejects.toMatchObject({ status: 403 });
    await expect(commands.forceDeleteDepartment(f.admin.actor, supplier.id, supplierDep.id, confirmed, trace(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const supplierAdmin = await administrator(supplier, true, 'SUPPLIER');
    await expect(commands.forceDeleteOrganization(supplierAdmin.actor, f.target.id, confirmed, trace(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await db.session.update({ where: { id: f.admin.actor.sessionId }, data: { reauthenticatedAt: new Date(Date.now() - 360_000) } });
    await expect(commands.forceDeleteOrganization(f.admin.actor, f.target.id, confirmed, trace(), randomUUID())).rejects.toMatchObject({ status: 403 });
    expect(await db.organization.findUnique({ where: { id: f.target.id } })).toEqual(f.target);
  });

  it('denies preview and deletion of the disabled pending actor home before any lifecycle effect', async () => {
    const f = await fixture(); const confirmed = await confirmation(f.admin.actor, f.target.id);
    const pending = await db.organization.update({ where: { id: f.home.id }, data: { parentId: null, configurationRequired: true, status: 'DISABLED' } });
    const rejection = { status: 401, response: { code: 'AUTH_SESSION_REQUIRED' } };
    await expect(commands.previewOrganization(f.admin.actor, f.home.id)).rejects.toMatchObject(rejection);
    const key = randomUUID();
    await expect(commands.forceDeleteOrganization(f.admin.actor, f.home.id, confirmed, trace(), key)).rejects.toMatchObject(rejection);
    expect(await db.organization.findUnique({ where: { id: f.home.id } })).toEqual(pending);
    expect(await db.adminMutation.count({ where: { key } })).toBe(0);
    expect(await db.$queryRaw`SELECT id FROM administrative_deletions WHERE entity_id = ${f.home.id}::uuid`).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('rolls back stale CAS, effect failure, and audit failure without a deletion receipt or partial structure changes', async () => {
    const f = await fixture(); const child = await organization(f.target.id); const dep = await department(f.target.id); const pos = await position(f.target.id, dep.id);
    const key = randomUUID();
    await expect(f.remove(key, 2)).rejects.toMatchObject({ status: 409 });
    failEffect = true;
    await expect(f.remove(key)).rejects.toThrow('TEST_EFFECT_ROLLBACK');
    failEffect = false;
    const audit = app.get(AuditLogService); const record = audit.record;
    audit.record = async () => { throw new Error('TEST_AUDIT_ROLLBACK'); };
    try { await expect(f.remove(key)).rejects.toThrow('TEST_AUDIT_ROLLBACK'); } finally { audit.record = record; }
    expect(await db.organization.findUnique({ where: { id: f.target.id } })).toEqual(f.target);
    expect(await db.organization.findUnique({ where: { id: child.id } })).toEqual(child);
    expect(await db.department.findUnique({ where: { id: dep.id } })).toEqual(dep);
    expect(await db.position.findUnique({ where: { id: pos.id } })).toEqual(pos);
    expect(await db.adminMutation.count({ where: { key } })).toBe(0);
    expect(await db.$queryRaw`SELECT id FROM administrative_deletions WHERE entity_id = ${f.target.id}::uuid`).toEqual([]);
    await f.remove(key);
  });

  it('can delete a disabled internal target and a department in a disabled surviving organization', async () => {
    const f = await fixture(); const dep = await department(f.target.id);
    await db.organization.update({ where: { id: f.target.id }, data: { status: 'DISABLED' } });
    await expect(commands.previewDepartment(f.admin.actor, f.target.id, dep.id)).resolves.toMatchObject({ id: dep.id });
    await expect(removeDepartment(f.admin.actor, f.target.id, dep.id, randomUUID())).resolves.toMatchObject({ id: dep.id });
    await expect(f.remove()).resolves.toMatchObject({ id: f.target.id });
  });

  it('requires each independent force permission even for a valid marker and denies deleting its own sole marker department', async () => {
    const f = await fixture(); const targetDep = await department(f.target.id);
    const orgConfirmed = await confirmation(f.admin.actor, f.target.id);
    const depConfirmed = await confirmation(f.admin.actor, f.target.id, targetDep.id);
    for (const code of ['organization:force-delete', 'organization:departments:force-delete']) {
      const p = await db.permission.findUniqueOrThrow({ where: { code } });
      const grants = await db.rolePermission.findMany({ where: { permissionId: p.id } });
      await db.permission.delete({ where: { code } });
      try {
        const command = code === 'organization:force-delete' ? commands.forceDeleteOrganization(f.admin.actor, f.target.id, orgConfirmed, trace(), randomUUID())
          : commands.forceDeleteDepartment(f.admin.actor, f.target.id, targetDep.id, depConfirmed, trace(), randomUUID());
        await expect(command).rejects.toMatchObject({ status: 403 });
      } finally {
        await db.permission.create({ data: p });
        await db.rolePermission.createMany({ data: grants });
      }
    }
    const dep = await department(f.home.id); const pos = await position(f.home.id, dep.id);
    await db.positionRole.create({ data: { organizationId: f.home.id, positionId: pos.id, roleId: f.admin.role.id } });
    await db.userPosition.create({ data: { organizationId: f.home.id, userId: f.admin.user.id, positionId: pos.id } });
    await db.userRole.deleteMany({ where: { userId: f.admin.user.id } });
    await expect(removeDepartment(f.admin.actor, f.home.id, dep.id, randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(await db.department.findUnique({ where: { id: dep.id } })).toEqual(dep);
    expect(await db.position.findUnique({ where: { id: pos.id } })).toEqual(pos);
  });

  it('rolls back an ancestor deletion that would disable the actor home even though the target is not its own home', async () => {
    const f = await fixture(); const home = await organization(f.target.id); const admin = await administrator(home);
    await expect(removeOrganization(admin.actor, f.target.id, randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(await db.organization.findUnique({ where: { id: f.target.id } })).toEqual(f.target);
    expect(await db.organization.findUnique({ where: { id: home.id } })).toEqual(home);
  });

  it('rejects replay by another actor, changed payload, revoked marker or expired RecentAuth', async () => {
    const f = await fixture(); const key = randomUUID(); await f.remove(key);
    await expect(f.remove(key, 2)).rejects.toMatchObject({ status: 409 });
    const other = await administrator(f.home);
    await expect(removeOrganization(other.actor, f.target.id, key)).rejects.toMatchObject({ status: 404 });
    await db.userRole.deleteMany({ where: { userId: f.admin.user.id } });
    await expect(f.remove(key)).rejects.toMatchObject({ status: 403 });
    await db.userRole.create({ data: { organizationId: f.home.id, userId: f.admin.user.id, roleId: f.admin.role.id } });
    await db.session.update({ where: { id: f.admin.actor.sessionId }, data: { reauthenticatedAt: new Date(0) } });
    await expect(f.remove(key)).rejects.toMatchObject({ status: 403 });
  });

  it('maps concurrent deletion to one success and a controlled missing-target/conflict, never a second deletion', async () => {
    const f = await fixture(); const second = await administrator(f.home);
    const results = await Promise.allSettled([f.remove(), removeOrganization(second.actor, f.target.id, randomUUID())]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(r => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect([404, 409]).toContain(rejected[0]!.reason.status);
    expect(await db.$queryRaw`SELECT id FROM administrative_deletions WHERE entity_id = ${f.target.id}::uuid`).toHaveLength(1);
  });

  it('rechecks marker revocation committed while waiting for the global lifecycle lock', async () => {
    const f = await fixture();
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('administrative-lifecycle',0))");
      pending = f.remove();
      // Observe an actual lock wait, not a timer-based assumption that the command has started.
      const deadline = Date.now() + 2500;
      let waiting = false;
      while (Date.now() < deadline) {
        await blocker.query('SELECT pg_stat_clear_snapshot()');
        const result = await blocker.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event = 'advisory' AND query LIKE '%administrative-lifecycle%'");
        if (result.rowCount) { waiting = true; break; }
        await setTimeout(20);
      }
      expect(waiting).toBe(true);
      await blocker.query('DELETE FROM user_roles WHERE user_id = $1::uuid', [f.admin.user.id]);
      await blocker.query('COMMIT');
      await expect(pending).rejects.toMatchObject({ status: 403 });
      expect(await db.organization.findUnique({ where: { id: f.target.id } })).toEqual(f.target);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      await pending?.catch(() => undefined);
    }
  });

  it('maps a real actor/target lock-order deadlock to 409 and never leaves a success receipt', async () => {
    const f = await fixture(); const key = randomUUID();
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query("SET LOCAL deadlock_timeout = '10s'");
      await blocker.query('SELECT id FROM organizations WHERE id = $1::uuid FOR UPDATE', [f.target.id]);
      // Keep rejection handled while PostgreSQL resolves the lock cycle.
      pending = f.remove(key);
      const outcome = pending.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
      const deadline = Date.now() + 2500;
      let waiting = false;
      while (Date.now() < deadline) {
        await blocker.query('SELECT pg_stat_clear_snapshot()');
        const result = await blocker.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%FROM organizations%FOR UPDATE%'");
        if (result.rowCount) { waiting = true; break; }
        await setTimeout(20);
      }
      expect(waiting).toBe(true);
      await blocker.query('SELECT id FROM users WHERE id = $1::uuid FOR UPDATE', [f.admin.user.id]);
      await blocker.query('COMMIT');
      const result = await outcome;
      expect(result.error).toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
      expect(await db.organization.findUnique({ where: { id: f.target.id } })).toEqual(f.target);
      expect(await db.adminMutation.count({ where: { key } })).toBe(0);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      await pending?.catch(() => undefined);
    }
  });

  it('fails closed with an incomplete registry and does not commit a tombstone', async () => {
    const f = await fixture();
    const incomplete = new OrganizationForceDeleteService(db, app.get(AdminMutationService), app.get(AuditLogService), new AdministrativeLifecycleRegistry());
    await expect(incomplete.forceDeleteOrganization(f.admin.actor, f.target.id, await confirmation(f.admin.actor, f.target.id), trace(), randomUUID())).rejects.toThrow('ADMIN_LIFECYCLE_EFFECTS_INCOMPLETE');
    expect(await db.organization.findUnique({ where: { id: f.target.id } })).toEqual(f.target);
  });

  it('validates every UUID, confirmation and version, rejects forged impact and requires session/CSRF/idempotency', async () => {
    const f = await fixture(); const dep = await department(f.target.id);
    await request(app.getHttpServer()).get(path(f.target.id)).expect(401);
    await request(app.getHttpServer()).post(path(f.target.id)).set('Cookie', f.admin.cookie).send(body).expect(403);
    for (const uri of [path('bad-id'), path(f.target.id, 'bad-id'), path('bad-id', dep.id)]) {
      await request(app.getHttpServer()).get(uri).set('Cookie', f.admin.cookie).expect(400);
      await request(app.getHttpServer()).post(uri).set('Cookie', f.admin.cookie).set('x-csrf-token', 'command-csrf').set('Idempotency-Key', randomUUID()).send(body).expect(400);
    }
    const confirmed = await confirmation(f.admin.actor, f.target.id);
    for (const invalid of [{ ...confirmed, previewToken: undefined }, { ...confirmed, previewToken: 'x'.repeat(64) }, { ...confirmed, previewToken: 'a'.repeat(63) }, { ...confirmed, confirmed: undefined }, { ...body, confirmed: false }, { ...body, expectedVersion: '1' }, { ...body, expectedVersion: 0 }, { ...body, expectedVersion: 1.5 }, { ...body, userIds: [f.admin.user.id] }]) {
      await request(app.getHttpServer()).post(path(f.target.id)).set('Cookie', f.admin.cookie).set('x-csrf-token', 'command-csrf').set('Idempotency-Key', randomUUID()).send({ ...confirmed, ...invalid }).expect(400);
    }
    await request(app.getHttpServer()).post(path(f.target.id)).set('Cookie', f.admin.cookie).set('x-csrf-token', 'command-csrf').send(confirmed).expect(400);
    expect(await db.organization.findUnique({ where: { id: f.target.id } })).toEqual(f.target);
  });
});
