import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { ACTIVE_PERMISSION_CODES, INTERNAL_PLATFORM_PERMISSION_CODES, PLATFORM_INACTIVE_MANAGEMENT_PERMISSION_CODES } from '../../src/modules/authorization/permission-catalog.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('Console context requires explicitly disposable loopback PostgreSQL, never preview 55440.');
}

const path = '/api/v1/admin/console/context';

describe('REQ0032 console context with real HTTP sessions and PostgreSQL authorization', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  const organizationIds: string[] = [];

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    sessions = app.get(SessionService);
    // Catalogue-only fixture setup, not the demo seed or an implicit user grant.
    for (const code of ACTIVE_PERMISSION_CODES) await prisma.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
  });
  afterAll(async () => {
    try {
      if (organizationIds.length) {
        const where = { organizationId: { in: organizationIds } };
        await prisma.auditEvent.deleteMany({ where });
        await prisma.userRole.deleteMany({ where });
        await prisma.positionRole.deleteMany({ where });
        await prisma.userPosition.deleteMany({ where });
        await prisma.position.deleteMany({ where });
        await prisma.department.deleteMany({ where });
        await prisma.user.deleteMany({ where });
        await prisma.role.deleteMany({ where });
        await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      }
    } finally { await app?.close(); }
  });

  async function organization(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const result = await prisma.organization.create({ data: { code: randomUUID(), name: `Console private ${randomUUID()}`, type } });
    organizationIds.push(result.id);
    return result;
  }
  async function fixture(accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const home = await organization(accountType);
    const user = await prisma.user.create({ data: { organizationId: home.id, accountType, username: randomUUID(), passwordHash: 'not-a-login-credential' } });
    const token = await sessions.create(user.id, prisma, { mfaVerified: true });
    return { home, user, cookie: `qms_session=${token}` };
  }
  async function grant(userId: string, organizationId: string, codes: string[]) {
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Ordinary role name', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { userId, organizationId, roleId: role.id } });
    return role;
  }
  const get = (cookie: string, organizationId?: string) => request(app.getHttpServer()).get(path).set('Cookie', cookie).query(organizationId ? { organizationId } : {});

  it('requires a real authenticated session', async () => {
    expect((await request(app.getHttpServer()).get(path).expect(401)).body.code).toBe('AUTH_SESSION_REQUIRED');
  });
  it('allows workflow-only personnel at their actual session home without user capabilities', async () => {
    const f = await fixture();
    await grant(f.user.id, f.home.id, ['workflow:manage']);
    const response = await get(f.cookie).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ actor: { id: f.user.id, accountType: 'INTERNAL', homeOrganization: { id: f.home.id } }, targetOrganization: { id: f.home.id }, hasPlatformAdministrator: false });
    expect(response.body.modules).toEqual([{ key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: f.home.id, permissions: ['workflow:manage'] }]);
    expect(response.body.organizations.map((item: { id: string }) => item.id)).toEqual([f.home.id]);
    expect(Object.keys(response.body.actor).sort()).toEqual(['accountType', 'homeOrganization', 'id']);
    expect(Object.keys(response.body.organizations[0]).sort()).toEqual(['code', 'configurationRequired', 'id', 'name', 'status', 'type']);
  });
  it.each(['account:users:read', 'organization:structure:manage', 'material-master:write', 'customer-quality:complaints:write'])('admits a real scoped management/maintenance grant %s', async code => {
    const f = await fixture();
    await grant(f.user.id, f.home.id, [code]);
    expect((await get(f.cookie).expect(200)).body.modules).toEqual([expect.objectContaining({ scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: f.home.id, permissions: [code] })]);
  });
  it.each([[], ['workflow:act', 'problem-index:read'], ['material-master:read', 'component-project:read', 'supplier-quality:profiles:read', 'customer-quality:complaints:read']].map(codes => ({ codes })))('rejects ordinary internal business permissions $codes without a directory', async ({ codes }) => {
    const f = await fixture();
    if (codes.length) await grant(f.user.id, f.home.id, codes);
    const response = await get(f.cookie).expect(403);
    expect(response.body.code).toBe('FEATURE_PERMISSION_DENIED');
    expect(JSON.stringify(response.body)).not.toContain(f.home.name);
  });
  it('rejects a supplier with both marker and explicit internal management grants', async () => {
    const f = await fixture('SUPPLIER'), target = await organization();
    await grant(f.user.id, f.home.id, ['platform:admin', 'workflow:manage']);
    await grant(f.user.id, target.id, ['account:users:read']);
    await get(f.cookie).expect(403);
    await get(f.cookie, target.id).expect(403);
  });
  it('keeps target capability scope distinct from home-only workflow management', async () => {
    const f = await fixture(), target = await organization(), hidden = await organization();
    await grant(f.user.id, f.home.id, ['workflow:manage']);
    await grant(f.user.id, target.id, ['account:users:read', 'workflow:manage']);
    const result = (await get(f.cookie, target.id).expect(200)).body;
    expect(result.actor.homeOrganization.id).toBe(f.home.id);
    expect(result.targetOrganization.id).toBe(target.id);
    expect(result.modules).toEqual(expect.arrayContaining([
      { key: 'users', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: target.id, permissions: ['account:users:read'] },
      { key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: f.home.id, permissions: ['workflow:manage'] },
    ]));
    expect(result.organizations.map((item: { id: string }) => item.id).sort()).toEqual([f.home.id, target.id].sort());
    expect(JSON.stringify(result)).not.toContain(hidden.name);
  });
  it('treats authorized target UUID letter case as the same scope without admitting foreign targets', async () => {
    const f = await fixture(), hidden = await organization();
    const target = await prisma.organization.create({ data: { id: `a${randomUUID().slice(1)}`, code: randomUUID(), name: 'Canonical console target', type: 'INTERNAL' } });
    organizationIds.push(target.id);
    await grant(f.user.id, f.home.id, ['workflow:manage']);
    await grant(f.user.id, target.id, ['account:users:read']);
    expect(target.id.toUpperCase()).not.toBe(target.id);
    const denied = await get(f.cookie, hidden.id.toUpperCase()).expect(403);
    expect(denied.body.code).toBe('ORGANIZATION_SCOPE_DENIED');
    expect(JSON.stringify(denied.body)).not.toContain(hidden.name);
    const lower = await get(f.cookie, target.id).expect(200);
    const upper = await get(f.cookie, target.id.toUpperCase()).expect(200);
    expect(upper.body).toEqual(lower.body);
    expect(upper.body.targetOrganization.id).toBe(target.id);
  });
  it('cannot use home workflow capability or cross-target workflow-only grants to select an unauthorized target', async () => {
    const f = await fixture(), target = await organization();
    await grant(f.user.id, f.home.id, ['workflow:manage']);
    await grant(f.user.id, target.id, ['workflow:manage']);
    for (const id of [target.id, randomUUID()]) {
      const response = await get(f.cookie, id).expect(403);
      expect(response.body.code).toBe('ORGANIZATION_SCOPE_DENIED');
      expect(JSON.stringify(response.body)).not.toContain(id);
      expect(JSON.stringify(response.body)).not.toContain(target.name);
    }
    await get(f.cookie).expect(200);
  });
  it('defaults to a real manageable organization when home has no management grant, never falling back for an explicit target', async () => {
    const f = await fixture(), target = await organization(), hidden = await organization();
    await grant(f.user.id, target.id, ['organization:manage']);
    const result = (await get(f.cookie).expect(200)).body;
    expect(result.actor.homeOrganization.id).toBe(f.home.id);
    expect(result.targetOrganization.id).toBe(target.id);
    expect(result.organizations.map((item: { id: string }) => item.id)).toEqual([target.id]);
    for (const id of [hidden.id, randomUUID()]) {
      const denied = await get(f.cookie, id).expect(403);
      expect(denied.body.code).toBe('ORGANIZATION_SCOPE_DENIED');
      expect(JSON.stringify(denied.body)).not.toContain(hidden.name);
    }
  });
  it('projects a real platform marker to new internal targets but not implicit supplier targets', async () => {
    const f = await fixture();
    await grant(f.user.id, f.home.id, ['platform:admin']);
    const target = await organization(), supplier = await organization('SUPPLIER');
    const result = (await get(f.cookie, target.id).expect(200)).body;
    expect(result.hasPlatformAdministrator).toBe(true);
    expect(result.modules.map((item: { key: string }) => item.key)).toEqual(expect.arrayContaining(['users', 'organizations', 'master-data', 'configuration', 'workflows', 'audit', 'outbox', 'reconfiguration', 'problem-reconfiguration', 'supplier-accounts']));
    for (const key of ['supplier-accounts', 'reconfiguration', 'problem-reconfiguration']) {
      expect(result.modules.find((item: { key: string }) => item.key === key)).toMatchObject({ scope: 'SESSION_HOME', coverage: 'PLATFORM', organizationId: f.home.id });
    }
    expect(result.modules.flatMap((item: { permissions: string[] }) => item.permissions).every((code: string) => INTERNAL_PLATFORM_PERMISSION_CODES.includes(code))).toBe(true);
    expect(result.modules.flatMap((item: { permissions: string[] }) => item.permissions)).not.toContain('workflow:act');
    expect(result.organizations.some((item: { id: string }) => item.id === supplier.id)).toBe(false);
    await get(f.cookie, supplier.id).expect(403);
  });
  it.each([false, true])('preserves governance-only protection for disabled/pending targets (pending=%s)', async pending => {
    const f = await fixture(), target = await organization();
    await grant(f.user.id, f.home.id, ['platform:admin']);
    await prisma.organization.update({ where: { id: target.id }, data: { status: 'DISABLED', configurationRequired: pending } });
    const result = (await get(f.cookie, target.id).expect(200)).body;
    expect(result.targetOrganization).toMatchObject({ status: 'DISABLED', configurationRequired: pending });
    const targetModules = result.modules.filter((item: { scope: string }) => item.scope === 'TARGET');
    expect(targetModules.flatMap((item: { permissions: string[] }) => item.permissions).every((code: string) => PLATFORM_INACTIVE_MANAGEMENT_PERMISSION_CODES.includes(code))).toBe(true);
    expect(targetModules.map((item: { key: string }) => item.key)).not.toEqual(expect.arrayContaining(['master-data', 'configuration', 'outbox']));
  });
  it('does not revive ordinary target business management after organization disablement', async () => {
    const f = await fixture(), target = await organization();
    await grant(f.user.id, target.id, ['account:users:read', 'organization:manage', 'audit:read']);
    await prisma.organization.update({ where: { id: target.id }, data: { status: 'DISABLED' } });
    expect((await get(f.cookie, target.id).expect(200)).body.modules).toEqual([{ key: 'organizations', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: target.id, permissions: ['organization:manage'] }]);
  });
  it('rechecks revoked platform permissions without retaining a cached directory', async () => {
    const f = await fixture(), target = await organization();
    const role = await grant(f.user.id, f.home.id, ['platform:admin']);
    await get(f.cookie, target.id).expect(200);
    const marker = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: marker.id } } });
    await get(f.cookie, target.id).expect(403);
    await get(f.cookie).expect(403);
  });
  it('uses actual effective appointments and immediately loses ended position-only grants', async () => {
    const f = await fixture();
    const role = await grant(f.user.id, f.home.id, ['workflow:manage']);
    const department = await prisma.department.create({ data: { organizationId: f.home.id, code: randomUUID(), name: 'Console department' } });
    const position = await prisma.position.create({ data: { organizationId: f.home.id, departmentId: department.id, code: randomUUID(), name: 'Console workflow manager' } });
    await prisma.positionRole.create({ data: { organizationId: f.home.id, positionId: position.id, roleId: role.id } });
    const assignment = await prisma.userPosition.create({ data: { organizationId: f.home.id, userId: f.user.id, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } });
    await get(f.cookie).expect(200);
    await prisma.userPosition.update({ where: { id: assignment.id }, data: { endedAt: new Date() } });
    await get(f.cookie).expect(403);
  });
  it.each(['organizationId=not-a-uuid', 'organizationId=', `organizationId=${randomUUID()}&organizationId=${randomUUID()}`, `organizationId=${randomUUID()}&userId=${randomUUID()}`])('rejects malformed, repeated or actor-spoofing query %s', async query => {
    const f = await fixture();
    await request(app.getHttpServer()).get(`${path}?${query}`).set('Cookie', f.cookie).expect(400);
  });
  it('rejects revoked, expired and disabled-subject sessions', async () => {
    const f = await fixture();
    await grant(f.user.id, f.home.id, ['account:users:read']);
    await prisma.session.updateMany({ where: { userId: f.user.id }, data: { revokedAt: new Date() } });
    await get(f.cookie).expect(401);
    const expired = await sessions.create(f.user.id, prisma, { expiresAt: new Date(Date.now() - 1000), mfaVerified: true });
    await get(`qms_session=${expired}`).expect(401);
    const token = await sessions.create(f.user.id, prisma, { mfaVerified: true });
    await prisma.user.update({ where: { id: f.user.id }, data: { status: 'DISABLED' } });
    await get(`qms_session=${token}`).expect(401);
  });
});
