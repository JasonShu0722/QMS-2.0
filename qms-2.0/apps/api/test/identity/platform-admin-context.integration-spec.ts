import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { ADMIN_PERMISSIONS, ADMINISTRATIVE_LIFECYCLE_PERMISSION_CODES, PLATFORM_INACTIVE_MANAGEMENT_PERMISSION_CODES } from '../../src/modules/authorization/permission-catalog.js';
import { effectiveRoleGrants } from '../../src/common/security/effective-role-grants.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('Administrator context requires explicitly disposable loopback PostgreSQL, never preview 55440.');
}

const path = '/api/v1/admin/organizations/context';
const managementCodes = [...ADMIN_PERMISSIONS, ...ADMINISTRATIVE_LIFECYCLE_PERMISSION_CODES, 'organization:read', 'component-project:read', 'component-project:manage', 'customer-quality:complaints:read', 'customer-quality:complaints:write', 'material-master:read', 'material-master:write', 'material-master:import', 'supplier-quality:profiles:read', 'supplier-quality:profiles:write'];

describe('REQ0031 read-only administrator context with real sessions, HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  const organizationIds: string[] = [];
  const retainedOrganizationIds = new Set<string>();

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    sessions = app.get(SessionService);
  });
  afterAll(async () => {
    try {
      if (organizationIds.length) {
        // Tombstones are intentionally immutable; their task-owned database is destroyed by the parent.
        const cleanupIds = organizationIds.filter(id => !retainedOrganizationIds.has(id));
        const where = { organizationId: { in: cleanupIds } };
        await prisma.auditEvent.deleteMany({ where });
        await prisma.userRole.deleteMany({ where });
        await prisma.positionRole.deleteMany({ where });
        await prisma.userPosition.deleteMany({ where });
        await prisma.position.deleteMany({ where });
        await prisma.department.deleteMany({ where });
        await prisma.user.deleteMany({ where });
        await prisma.role.deleteMany({ where });
        await prisma.organization.deleteMany({ where: { id: { in: cleanupIds } } });
      }
    } finally { await app?.close(); }
  });

  async function organization(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const result = await prisma.organization.create({ data: { code: randomUUID(), name: 'Private context organization', type } });
    organizationIds.push(result.id);
    return result;
  }
  async function fixture(accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const home = await organization(accountType);
    const user = await prisma.user.create({ data: { organizationId: home.id, accountType, username: randomUUID(), passwordHash: 'not-a-login-credential' } });
    const token = await sessions.create(user.id, prisma, { mfaVerified: true });
    return { home, user, token, cookie: `qms_session=${token}` };
  }
  async function grant(userId: string, organizationId: string, codes: string[]) {
    const permissions = await Promise.all(codes.map(code => prisma.permission.findUniqueOrThrow({ where: { code } })));
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Readable own source', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { userId, organizationId, roleId: role.id } });
    return role;
  }
  it('keeps deleted and pending structures out of normal trees and department/position directories', async () => {
    const f = await fixture();
    await grant(f.user.id, f.home.id, ['platform:admin']);
    retainedOrganizationIds.add(f.home.id);
    const hidden = await organization();
    retainedOrganizationIds.add(hidden.id);
    await prisma.organization.update({ where: { id: hidden.id }, data: { status: 'DISABLED', configurationRequired: true } });
    const currentDepartment = await prisma.department.create({ data: { organizationId: f.home.id, code: randomUUID(), name: 'Current department' } });
    const pendingDepartment = await prisma.department.create({ data: { organizationId: f.home.id, code: randomUUID(), name: 'Pending department', status: 'DISABLED', configurationRequired: true } });
    const deletedDepartment = await prisma.department.create({ data: { organizationId: f.home.id, code: randomUUID(), name: 'Deleted department', status: 'DISABLED', deletedAt: new Date() } });
    const pendingPosition = await prisma.position.create({ data: { organizationId: f.home.id, departmentId: currentDepartment.id, code: randomUUID(), name: 'Pending position', status: 'DISABLED', configurationRequired: true } });
    const deletedPosition = await prisma.position.create({ data: { organizationId: f.home.id, departmentId: currentDepartment.id, code: randomUUID(), name: 'Deleted position', status: 'DISABLED', deletedAt: new Date() } });
    const pendingUser = await prisma.user.create({ data: { organizationId: f.home.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL', status: 'DISABLED', configurationRequired: true } });
    const tree = await request(app.getHttpServer()).get(`/api/v1/organizations/tree?organizationId=${f.home.id}`).set('Cookie', f.cookie).expect(200);
    expect(tree.body.some((item: { id: string }) => item.id === hidden.id)).toBe(false);
    const departments = await request(app.getHttpServer()).get(`/api/v1/organizations/${f.home.id}/departments`).set('Cookie', f.cookie).expect(200);
    expect(departments.body.map((item: { id: string }) => item.id)).toContain(currentDepartment.id);
    expect(departments.body.map((item: { id: string }) => item.id)).not.toEqual(expect.arrayContaining([pendingDepartment.id]));
    expect(departments.body.map((item: { id: string }) => item.id)).not.toEqual(expect.arrayContaining([deletedDepartment.id]));
    const positions = await request(app.getHttpServer()).get(`/api/v1/organizations/${f.home.id}/positions`).set('Cookie', f.cookie).expect(200);
    expect(positions.body.map((item: { id: string }) => item.id)).not.toEqual(expect.arrayContaining([pendingPosition.id]));
    expect(positions.body.map((item: { id: string }) => item.id)).not.toEqual(expect.arrayContaining([deletedPosition.id]));
    const users = await request(app.getHttpServer()).get(`/api/v1/admin/users?organizationId=${f.home.id}`).set('Cookie', f.cookie).expect(200);
    expect(users.body.map((item: { id: string }) => item.id)).not.toEqual(expect.arrayContaining([pendingUser.id]));
  });

  async function position(userId: string, organizationId: string, roleId: string) {
    const department = await prisma.department.create({ data: { organizationId, code: randomUUID(), name: 'Context department' } });
    const position = await prisma.position.create({ data: { organizationId, departmentId: department.id, code: randomUUID(), name: 'Context position' } });
    await prisma.positionRole.create({ data: { organizationId, positionId: position.id, roleId } });
    return prisma.userPosition.create({ data: { organizationId, userId, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
  }
  it('keeps the customer-master write capability consistent between the real directory and context', async () => {
    const f = await fixture();
    await grant(f.user.id, f.home.id, ['customer-quality:complaints:write']);
    expect((await get(f.cookie).expect(200)).body.permissions).toEqual(['customer-quality:complaints:write']);
    const directory = (await request(app.getHttpServer()).get('/api/v1/admin/organizations').set('Cookie', f.cookie).expect(200)).body;
    expect(directory).toEqual(expect.arrayContaining([expect.objectContaining({ id: f.home.id, permissions: ['customer-quality:complaints:write'] })]));
  });
  const get = (cookie: string, organizationId?: string) => request(app.getHttpServer()).get(path).set('Cookie', cookie).query(organizationId ? { organizationId } : {});

  it('rejects anonymous context requests instead of exposing a public route', async () => {
    const response = await request(app.getHttpServer()).get(path).expect(401);
    expect(response.body.code).toBe('AUTH_SESSION_REQUIRED');
  });
  it('exposes the three real deletion capabilities and reconfiguration for an active platform scope', async () => {
    const f = await fixture(), target = await organization();
    await grant(f.user.id, f.home.id, ['platform:admin']);
    const response = await get(f.cookie, target.id).expect(200);
    expect(response.body.permissions).toEqual(expect.arrayContaining([
      'organization:force-delete', 'organization:departments:force-delete', 'account:users:delete', 'organization:reconfigure',
    ]));
    expect(response.body.permissions).not.toContain('workflow:act');
  });
  it('omits a deleted historical organization from the normal management directory', async () => {
    const f = await fixture(), target = await organization();
    await grant(f.user.id, f.home.id, ['platform:admin']);
    await prisma.organization.update({ where: { id: target.id }, data: { status: 'DISABLED', deletedAt: new Date() } });
    retainedOrganizationIds.add(target.id);
    const response = await request(app.getHttpServer()).get('/api/v1/admin/organizations').set('Cookie', f.cookie).expect(200);
    expect(response.body.some((entry: { id: string }) => entry.id === target.id)).toBe(false);
  });
  it('defaults to the real session home and returns NONE without management grants', async () => {
    const f = await fixture();
    const response = await get(f.cookie).expect(200);
    expect(response.body).toEqual({ hasPlatformAdministrator: false, homeOrganizationId: f.home.id, targetOrganizationId: f.home.id, accessKind: 'NONE', targetOrganizationStatus: 'ACTIVE', targetConfigurationRequired: false, permissions: [], authorizationSources: [] });
  });
  it('does not infer platform identity from an admin username or ordinary management permissions', async () => {
    const f = await fixture();
    await prisma.user.update({ where: { id: f.user.id }, data: { username: `admin.${randomUUID()}` } });
    const role = await grant(f.user.id, f.home.id, ['account:users:read', 'organization:manage', 'workflow:act']);
    const response = await get(f.cookie).expect(200);
    expect(response.body).toMatchObject({ hasPlatformAdministrator: false, accessKind: 'ORGANIZATION', permissions: ['account:users:read', 'organization:manage'], authorizationSources: [{ roleId: role.id, roleCode: role.code, roleName: role.name, sourceOrganizationIds: [f.home.id], sourceKinds: ['DIRECT'], platformAdministrator: false }] });
    expect(response.body.authorizationSources[0]).not.toHaveProperty('permissions');
    expect(response.body.permissions).not.toContain('platform:admin');
  });
  it('retains explicit ordinary cross-organization grants without changing actor home', async () => {
    const f = await fixture();
    const target = await organization();
    await grant(f.user.id, target.id, ['account:users:read']);
    expect((await get(f.cookie, target.id).expect(200)).body).toMatchObject({ hasPlatformAdministrator: false, homeOrganizationId: f.home.id, targetOrganizationId: target.id, accessKind: 'ORGANIZATION', permissions: ['account:users:read'] });
  });
  it('returns identical scope denials for existing and missing unauthorized targets without disclosing metadata', async () => {
    const f = await fixture();
    const target = await organization();
    for (const id of [target.id, randomUUID()]) {
      const response = await get(f.cookie, id).expect(403);
      expect(response.body.code).toBe('ORGANIZATION_SCOPE_DENIED');
      expect(JSON.stringify(response.body)).not.toContain(id);
      expect(JSON.stringify(response.body)).not.toContain(target.name);
    }
  });
  it('projects a real marker into a future internal target with only granted management codes and safe own sources', async () => {
    const f = await fixture();
    const role = await grant(f.user.id, f.home.id, ['platform:admin']);
    await position(f.user.id, f.home.id, role.id);
    const target = await organization();
    const before = await prisma.userRole.count({ where: { userId: f.user.id } });
    const response = await get(f.cookie, target.id).expect(200);
    const registered = await prisma.permission.findMany({ where: { code: { in: managementCodes } }, select: { code: true } });
    expect(response.body).toMatchObject({ hasPlatformAdministrator: true, homeOrganizationId: f.home.id, targetOrganizationId: target.id, accessKind: 'PLATFORM', targetOrganizationStatus: 'ACTIVE', permissions: registered.map(({ code }) => code).sort(), authorizationSources: [{ roleId: role.id, roleCode: role.code, roleName: role.name, sourceOrganizationIds: [f.home.id], sourceKinds: ['DIRECT', 'POSITION'], platformAdministrator: true }] });
    expect(Object.keys(response.body.authorizationSources[0]).sort()).toEqual(['platformAdministrator', 'roleCode', 'roleId', 'roleName', 'sourceKinds', 'sourceOrganizationIds']);
    expect(await prisma.userRole.count({ where: { userId: f.user.id } })).toBe(before);
    const directory = (await request(app.getHttpServer()).get('/api/v1/admin/organizations').set('Cookie', f.cookie).expect(200)).body;
    expect(Object.keys(directory.find((entry: { id: string }) => entry.id === target.id)).sort()).toEqual(['code', 'id', 'name', 'permissions', 'type']);
  });
  it('immediately loses platform projection when the final marker is revoked', async () => {
    const f = await fixture();
    const target = await organization();
    const role = await grant(f.user.id, f.home.id, ['platform:admin', 'account:users:read']);
    expect((await get(f.cookie, target.id).expect(200)).body.accessKind).toBe('PLATFORM');
    const marker = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: marker.id } });
    await get(f.cookie, target.id).expect(403);
    expect((await get(f.cookie).expect(200)).body).toMatchObject({ hasPlatformAdministrator: false, accessKind: 'ORGANIZATION', permissions: ['account:users:read'] });
  });
  it('rechecks expired position-only marker sources on every request', async () => {
    const f = await fixture();
    const role = await grant(f.user.id, f.home.id, ['platform:admin']);
    const assignment = await position(f.user.id, f.home.id, role.id);
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } });
    expect((await get(f.cookie).expect(200)).body.hasPlatformAdministrator).toBe(true);
    await prisma.userPosition.update({ where: { id: assignment.id }, data: { endedAt: new Date() } });
    expect((await get(f.cookie).expect(200)).body).toMatchObject({ hasPlatformAdministrator: false, accessKind: 'NONE', authorizationSources: [] });
  });
  it('reports a disabled target with only usable governance and audit permissions for a platform administrator', async () => {
    const f = await fixture();
    await grant(f.user.id, f.home.id, ['platform:admin']);
    const target = await organization();
    await prisma.organization.update({ where: { id: target.id }, data: { status: 'DISABLED' } });
    const result = (await get(f.cookie, target.id).expect(200)).body;
    expect(result).toMatchObject({ accessKind: 'PLATFORM', targetOrganizationStatus: 'DISABLED', permissions: [...PLATFORM_INACTIVE_MANAGEMENT_PERMISSION_CODES].sort() });
    expect(result.permissions).toEqual(expect.arrayContaining(['organization:force-delete', 'organization:departments:force-delete', 'account:users:delete', 'organization:reconfigure']));
    expect(result.permissions).not.toContain('account:users:update');
  });
  it('does not advertise platform-only lifecycle codes assigned directly to an ordinary administrator', async () => {
    const f = await fixture();
    await grant(f.user.id, f.home.id, ['account:users:read', ...ADMINISTRATIVE_LIFECYCLE_PERMISSION_CODES]);
    const result = (await get(f.cookie).expect(200)).body;
    expect(result.hasPlatformAdministrator).toBe(false);
    expect(result.permissions).toEqual(['account:users:read']);
    expect(result.accessKind).toBe('ORGANIZATION');
  });
  it('does not report disabled-target business management grants as usable for an ordinary administrator', async () => {
    const f = await fixture();
    const target = await organization();
    await grant(f.user.id, target.id, ['account:users:read', 'organization:manage', 'audit:read']);
    await prisma.organization.update({ where: { id: target.id }, data: { status: 'DISABLED' } });
    expect((await get(f.cookie, target.id).expect(200)).body).toMatchObject({ accessKind: 'ORGANIZATION', targetOrganizationStatus: 'DISABLED', permissions: ['organization:manage'] });
  });
  it('does not report disabled-target organization read without the required organization management grant', async () => {
    const f = await fixture();
    const target = await organization();
    await grant(f.user.id, target.id, ['organization:read']);
    await prisma.organization.update({ where: { id: target.id }, data: { status: 'DISABLED' } });
    expect((await get(f.cookie, target.id).expect(200)).body).toMatchObject({ accessKind: 'NONE', permissions: [], authorizationSources: [] });
  });
  it('never grants a platform administrator implicit access to a supplier target', async () => {
    const f = await fixture();
    await grant(f.user.id, f.home.id, ['platform:admin']);
    await get(f.cookie, (await organization('SUPPLIER')).id).expect(403);
  });
  it('does not project a deleted target as an ordinary disabled organization', async () => {
    const f = await fixture();
    await grant(f.user.id, f.home.id, ['platform:admin']);
    const target = await organization();
    retainedOrganizationIds.add(target.id);
    await prisma.organization.update({ where: { id: target.id }, data: { status: 'DISABLED', deletedAt: new Date() } });
    const hasScope = (await effectiveRoleGrants(prisma, f.user.id, target.id)).length > 0;
    const response = await get(f.cookie, target.id).expect(hasScope ? 404 : 403);
    expect(response.body.code).toBe(response.status === 404 ? 'ORGANIZATION_NOT_FOUND' : 'ORGANIZATION_SCOPE_DENIED');
    expect(JSON.stringify(response.body)).not.toContain(target.id);
    expect(JSON.stringify(response.body)).not.toContain(target.name);
  });
  it('explicitly marks a target awaiting reconfiguration instead of presenting a normal active organization', async () => {
    const f = await fixture();
    await grant(f.user.id, f.home.id, ['platform:admin']);
    const target = await organization();
    await prisma.organization.update({ where: { id: target.id }, data: { status: 'DISABLED', configurationRequired: true } });
    expect((await get(f.cookie, target.id).expect(200)).body).toMatchObject({ accessKind: 'PLATFORM', targetOrganizationStatus: 'DISABLED', targetConfigurationRequired: true, permissions: [...PLATFORM_INACTIVE_MANAGEMENT_PERMISSION_CODES].sort() });
  });
  it.each(['deleted', 'configuration-required'])('rejects a %s subject session instead of presenting a normal identity', async state => {
    const f = await fixture();
    if (state === 'deleted') retainedOrganizationIds.add(f.home.id);
    await prisma.user.update({ where: { id: f.user.id }, data: { status: 'DISABLED', ...(state === 'deleted' ? { deletedAt: new Date() } : { configurationRequired: true }) } });
    await get(f.cookie).expect(401);
  });
  it('does not let supplier marker or explicit internal grants disclose an internal directory', async () => {
    const f = await fixture('SUPPLIER');
    await grant(f.user.id, f.home.id, ['platform:admin']);
    const target = await organization();
    await grant(f.user.id, target.id, ['account:users:read']);
    expect((await get(f.cookie).expect(200)).body).toMatchObject({ hasPlatformAdministrator: false, accessKind: 'NONE', permissions: [], authorizationSources: [] });
    await get(f.cookie, target.id).expect(403);
    await get(f.cookie, randomUUID()).expect(403);
  });
  it.each(['organizationId=not-a-uuid', 'organizationId=', `organizationId=${randomUUID()}&organizationId=${randomUUID()}`, `organizationId=${randomUUID()}&userId=${randomUUID()}`])('rejects malformed, repeated or actor-spoofing query %s', async query => {
    const f = await fixture();
    await request(app.getHttpServer()).get(`${path}?${query}`).set('Cookie', f.cookie).expect(400);
  });
  it('rejects revoked, expired and disabled-subject sessions', async () => {
    const f = await fixture();
    await prisma.session.updateMany({ where: { userId: f.user.id }, data: { revokedAt: new Date() } });
    await get(f.cookie).expect(401);
    const expired = await sessions.create(f.user.id, prisma, { expiresAt: new Date(Date.now() - 1000), mfaVerified: true });
    await get(`qms_session=${expired}`).expect(401);
    const token = await sessions.create(f.user.id, prisma, { mfaVerified: true });
    await prisma.user.update({ where: { id: f.user.id }, data: { status: 'DISABLED' } });
    await get(`qms_session=${token}`).expect(401);
  });
});
