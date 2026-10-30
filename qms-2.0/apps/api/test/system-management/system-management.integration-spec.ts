import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { HttpException, ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { AdministrativeReconfigurationKind as Kind } from '../../src/common/security/administrative-reconfiguration.dto.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AdminUserReconfigurationService } from '../../src/modules/identity/admin-user-reconfiguration.service.js';
import { OrganizationReconfigurationService } from '../../src/modules/organization/organization-reconfiguration.service.js';
import { AuditQueryService } from '../../src/modules/audit-log/audit-query.service.js';
import { OutboxAdministrationService } from '../../src/modules/task-notification/outbox-administration.service.js';
import { ACTIVE_PERMISSION_CODES } from '../../src/modules/authorization/permission-catalog.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('Console home requires explicitly disposable loopback PostgreSQL, never preview 55440.');
}

const path = '/api/v1/admin/console/home';
const pendingKeys = ['reconfiguration-organizations', 'reconfiguration-departments', 'reconfiguration-positions', 'reconfiguration-users'];
type Source = {
  key: string; status: 'AVAILABLE' | 'UNAVAILABLE'; scope: string; coverage: string; organizationId: string;
  completedAt: string; total?: number; items?: Array<{ id: string; organizationId: string }>;
  reasonCode?: string;
};
const source = (body: { sources: Source[] }, key: string) => {
  const result = body.sources.find(entry => entry.key === key);
  expect(result).toBeDefined();
  return result!;
};

describe('REQ0032 management home through real HTTP sessions and PostgreSQL owners', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  const organizationIds: string[] = [];
  const eventIds: string[] = [];

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    sessions = app.get(SessionService);
    for (const code of ACTIVE_PERMISSION_CODES) await prisma.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try {
      if (eventIds.length) await prisma.outboxEvent.deleteMany({ where: { id: { in: eventIds } } });
      if (organizationIds.length) {
        const where = { organizationId: { in: organizationIds } };
        await prisma.auditEvent.deleteMany({ where });
        await prisma.fileObject.deleteMany({ where });
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
    const result = await prisma.organization.create({ data: { code: randomUUID(), name: `Private console home ${randomUUID()}`, type } });
    organizationIds.push(result.id);
    return result;
  }
  async function fixture(codes: string[], accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const home = await organization(accountType);
    const user = await prisma.user.create({ data: { organizationId: home.id, accountType, username: randomUUID(), passwordHash: 'not-a-login-credential' } });
    if (codes.length) await grant(user.id, home.id, codes);
    const token = await sessions.create(user.id, prisma, { mfaVerified: true });
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    return { home, user, cookie: `qms_session=${token}`, actor: { id: user.id, organizationId: home.id, sessionId: session.id, accountType } };
  }
  async function grant(userId: string, organizationId: string, codes: string[]) {
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Console home permission fixture', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { userId, organizationId, roleId: role.id } });
  }
  const get = (cookie: string, organizationId?: string) => request(app.getHttpServer()).get(path).set('Cookie', cookie).query(organizationId ? { organizationId } : {});
  async function failedScan(organizationId: string, uploadedById: string) {
    const file = await prisma.fileObject.create({ data: {
      organizationId, uploadedById, objectKey: `console-home/${randomUUID()}`, originalName: 'private-file.txt', contentType: 'text/plain',
      sizeBytes: 1n, sha256: 'a'.repeat(64), objectVersionId: randomUUID(), scanStatus: 'ERROR', resourceType: 'ConsoleHomeFixture', resourceId: randomUUID(), resourceVersion: 1,
    } });
    const event = await prisma.outboxEvent.create({ data: {
      aggregateType: 'FileObject', aggregateId: file.id, eventType: 'FILE_SCAN_REQUESTED', eventKey: `file-scan:${file.id}:${file.version}`,
      status: 'FAILED', attempts: 5, lastError: 'private-handler-stack',
      payload: { schemaVersion: 1, organizationId, fileId: file.id, fileVersion: file.version },
    } });
    eventIds.push(event.id);
    return event;
  }

  it('admits workflow-only personnel without querying old organization directories or inventing totals', async () => {
    const f = await fixture(['workflow:manage']);
    const audit = jest.spyOn(app.get(AuditQueryService), 'list');
    const outbox = jest.spyOn(app.get(OutboxAdministrationService), 'list');
    const organizations = jest.spyOn(app.get(OrganizationReconfigurationService), 'listPending');
    const users = jest.spyOn(app.get(AdminUserReconfigurationService), 'listPending');
    const result = await get(f.cookie).expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.context).toMatchObject({ actor: { id: f.user.id }, targetOrganization: { id: f.home.id } });
    expect(result.body.context.modules).toEqual([{ key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: f.home.id, permissions: ['workflow:manage'] }]);
    expect(result.body.sources).toEqual([]);
    for (const owner of [audit, outbox, organizations, users]) expect(owner).not.toHaveBeenCalled();
    expect(Number.isFinite(Date.parse(result.body.asOf))).toBe(true);
    expect(JSON.stringify(result.body)).not.toMatch(/successRate|onlineServices|api-observations|data-exchanges/);
  });

  it('uses the outbox owner total rather than its one-row sample and hides other organizations and handler details', async () => {
    const f = await fixture(['outbox:read']);
    const foreign = await fixture(['outbox:read']);
    await failedScan(f.home.id, f.user.id);
    await failedScan(f.home.id, f.user.id);
    await failedScan(foreign.home.id, foreign.user.id);
    const owner = jest.spyOn(app.get(OutboxAdministrationService), 'list');
    const result = await get(f.cookie).expect(200);
    expect(result.body.sources).toHaveLength(1);
    expect(source(result.body, 'outbox')).toMatchObject({ status: 'AVAILABLE', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: f.home.id, total: 2 });
    expect(owner).toHaveBeenCalledTimes(1);
    expect(owner.mock.calls[0]?.[0]).toMatchObject(f.actor);
    expect(owner.mock.calls[0]?.[1]).toEqual({ organizationId: f.home.id, pageSize: 1, offset: 0 });
    expect(JSON.stringify(result.body)).not.toMatch(/private-handler-stack|private-file.txt|lastError|payload/);
    expect(JSON.stringify(result.body)).not.toContain(foreign.home.name);
  });

  it('treats authorized target UUID letter case as the same home aggregate scope without admitting foreign targets', async () => {
    const f = await fixture(['workflow:manage']);
    const hidden = await organization();
    const target = await prisma.organization.create({ data: { id: `a${randomUUID().slice(1)}`, code: randomUUID(), name: 'Canonical console home target', type: 'INTERNAL' } });
    organizationIds.push(target.id);
    await grant(f.user.id, target.id, ['outbox:read']);
    await failedScan(target.id, f.user.id);
    expect(target.id.toUpperCase()).not.toBe(target.id);
    const denied = await get(f.cookie, hidden.id.toUpperCase()).expect(403);
    expect(denied.body.code).toBe('ORGANIZATION_SCOPE_DENIED');
    expect(denied.body).not.toHaveProperty('context');
    expect(denied.body).not.toHaveProperty('sources');
    expect(JSON.stringify(denied.body)).not.toContain(hidden.name);
    const lower = await get(f.cookie, target.id).expect(200);
    const upper = await get(f.cookie, target.id.toUpperCase()).expect(200);
    expect(upper.body.context).toEqual(lower.body.context);
    expect(upper.body.context.targetOrganization.id).toBe(target.id);
    const projection = (body: { sources: Source[] }) => body.sources.map(({ completedAt: _completedAt, ...entry }) => entry);
    expect(projection(upper.body)).toEqual(projection(lower.body));
    expect(source(upper.body, 'outbox')).toMatchObject({ status: 'AVAILABLE', organizationId: target.id, total: 1 });
  });

  it.each(['outbox:retry', 'audit:export', 'organization:reconfigure'])('does not infer read or platform scope from the ordinary grant %s', async permission => {
    const f = await fixture([permission, 'workflow:manage']);
    const audit = jest.spyOn(app.get(AuditQueryService), 'list');
    const outbox = jest.spyOn(app.get(OutboxAdministrationService), 'list');
    const organizations = jest.spyOn(app.get(OrganizationReconfigurationService), 'listPending');
    const users = jest.spyOn(app.get(AdminUserReconfigurationService), 'listPending');
    const result = await get(f.cookie).expect(200);
    expect(result.body.sources).toEqual([]);
    for (const owner of [audit, outbox, organizations, users]) expect(owner).not.toHaveBeenCalled();
  });

  it('returns the five latest authorized audit events through the public owner without foreign names or unsafe metadata', async () => {
    const f = await fixture(['audit:read']);
    const target = await organization();
    const hidden = await organization();
    await grant(f.user.id, target.id, ['audit:read']);
    const expected: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const entry = await prisma.auditEvent.create({ data: { organizationId: target.id, action: 'CONFIG_UPDATED', resourceType: 'Configuration', outcome: 'SUCCESS', traceId: randomUUID(), createdAt: new Date(Date.now() - (10 - index) * 1000), metadata: { password: 'private-audit-secret' } } });
      expected.unshift(entry.id);
    }
    await prisma.auditEvent.create({ data: { organizationId: hidden.id, action: 'FOREIGN_PRIVATE_EVENT', resourceType: 'Configuration', outcome: 'SUCCESS', traceId: randomUUID() } });
    const owner = jest.spyOn(app.get(AuditQueryService), 'list');
    const result = await get(f.cookie, target.id).expect(200);
    const audit = source(result.body, 'audit');
    expect(audit).toMatchObject({ status: 'AVAILABLE', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: target.id });
    expect(audit.items?.map(entry => entry.id)).toEqual(expected.slice(0, 5));
    expect(audit.items?.every(entry => entry.organizationId === target.id)).toBe(true);
    expect(owner).toHaveBeenCalledTimes(1);
    expect(owner.mock.calls[0]?.[0]).toMatchObject(f.actor);
    expect(owner.mock.calls[0]?.[1]).toEqual({ organizationId: target.id, pageSize: 5 });
    expect(JSON.stringify(result.body)).not.toMatch(/private-audit-secret|FOREIGN_PRIVATE_EVENT/);
    expect(JSON.stringify(result.body)).not.toContain(hidden.name);
  });

  it('uses four independently authorized platform pending totals, with session home as authorization source rather than target', async () => {
    const f = await fixture(['platform:admin']);
    const target = await organization();
    const pending = await organization();
    await prisma.organization.update({ where: { id: pending.id }, data: { configurationRequired: true, status: 'DISABLED' } });
    await prisma.department.create({ data: { organizationId: pending.id, code: randomUUID(), name: 'Pending department', configurationRequired: true, status: 'DISABLED' } });
    await prisma.position.create({ data: { organizationId: pending.id, code: randomUUID(), name: 'Pending position', configurationRequired: true, status: 'DISABLED' } });
    await prisma.user.create({ data: { organizationId: pending.id, username: randomUUID(), passwordHash: 'not-a-login-credential', accountType: 'INTERNAL', configurationRequired: true, status: 'DISABLED' } });
    const organizations = app.get(OrganizationReconfigurationService);
    const users = app.get(AdminUserReconfigurationService);
    const expected = await Promise.all([Kind.ORGANIZATION, Kind.DEPARTMENT, Kind.POSITION].map(kind => organizations.listPending(f.actor, { kind, pageSize: 1, offset: 0 })));
    expected.push(await users.listPending(f.actor, { kind: Kind.USER, pageSize: 1, offset: 0 }));
    const organizationReads = jest.spyOn(organizations, 'listPending');
    const userReads = jest.spyOn(users, 'listPending');
    const result = await get(f.cookie, target.id).expect(200);
    pendingKeys.forEach((key, index) => {
      expect(expected[index]!.total).toBeGreaterThan(0);
      expect(source(result.body, key)).toMatchObject({ status: 'AVAILABLE', total: expected[index]!.total, scope: 'SESSION_HOME', coverage: 'PLATFORM', organizationId: f.home.id });
    });
    expect(organizationReads).toHaveBeenCalledTimes(3);
    expect(userReads).toHaveBeenCalledTimes(1);
    for (const call of [...organizationReads.mock.calls, ...userReads.mock.calls]) {
      expect(call[0]).toMatchObject(f.actor);
      expect(call[1]).toMatchObject({ pageSize: 1, offset: 0 });
    }
    expect(result.body.sources.map((entry: Source) => entry.key)).not.toContain('problem-reconfiguration');
    expect(JSON.stringify(result.body)).not.toContain('Pending department');
  });

  it('reports actual server query times on every independently completed source', async () => {
    const f = await fixture(['audit:read', 'outbox:read']);
    const before = Date.now();
    const result = await get(f.cookie).expect(200);
    const after = Date.now();
    expect(result.body.sources).toHaveLength(2);
    for (const value of [result.body.asOf, ...result.body.sources.map((entry: Source) => entry.completedAt)]) {
      expect(new Date(value).toISOString()).toBe(value);
      expect(Date.parse(value)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(value)).toBeLessThanOrEqual(after);
    }
  });

  // These are explicit owner fault injections, not evidence of a real service outage.
  it.each(['audit', 'outbox', ...pendingKeys])('keeps other real sources available when %s fails without exposing a fake zero or internal error', async key => {
    const f = await fixture(['platform:admin']);
    const failure = new Error('private-database-host-and-stack');
    if (key === 'audit') jest.spyOn(app.get(AuditQueryService), 'list').mockRejectedValueOnce(failure);
    else if (key === 'outbox') jest.spyOn(app.get(OutboxAdministrationService), 'list').mockRejectedValueOnce(failure);
    else if (key === 'reconfiguration-users') jest.spyOn(app.get(AdminUserReconfigurationService), 'listPending').mockRejectedValueOnce(failure);
    else {
      const owner = app.get(OrganizationReconfigurationService);
      const original = owner.listPending.bind(owner);
      const kind = [Kind.ORGANIZATION, Kind.DEPARTMENT, Kind.POSITION][pendingKeys.indexOf(key)];
      jest.spyOn(owner, 'listPending').mockImplementation((actor, query) => query.kind === kind ? Promise.reject(failure) : original(actor, query));
    }
    const result = await get(f.cookie).expect(200);
    expect(result.body.sources).toHaveLength(6);
    const failed = source(result.body, key);
    expect(failed).toMatchObject({ status: 'UNAVAILABLE', reasonCode: 'SOURCE_UNAVAILABLE' });
    expect(failed).not.toHaveProperty('total');
    expect(failed).not.toHaveProperty('items');
    expect(Number.isFinite(Date.parse(failed.completedAt))).toBe(true);
    expect(result.body.sources.filter((entry: Source) => entry.key !== key).every((entry: Source) => entry.status === 'AVAILABLE')).toBe(true);
    expect(JSON.stringify(result.body)).not.toContain(failure.message);
  });

  it('marks an owner 403 as requiring authorization revalidation rather than a healthy empty source', async () => {
    const f = await fixture(['audit:read', 'outbox:read']);
    jest.spyOn(app.get(AuditQueryService), 'list').mockRejectedValueOnce(new HttpException({ code: 'FEATURE_PERMISSION_DENIED', message: 'private authorization details' }, 403));
    const result = await get(f.cookie).expect(200);
    expect(source(result.body, 'audit')).toMatchObject({ status: 'UNAVAILABLE', reasonCode: 'AUTHORIZATION_CHANGED' });
    expect(source(result.body, 'audit')).not.toHaveProperty('items');
    expect(source(result.body, 'audit')).not.toHaveProperty('total');
    expect(source(result.body, 'outbox')).toMatchObject({ status: 'AVAILABLE', total: 0 });
    expect(JSON.stringify(result.body)).not.toContain('private authorization details');
  });

  it('fails the entire response on an owner 401 without returning another successful source or identity projection', async () => {
    const f = await fixture(['audit:read', 'outbox:read']);
    jest.spyOn(app.get(AuditQueryService), 'list').mockRejectedValueOnce(new HttpException({ code: 'AUTH_SESSION_REQUIRED', message: '需要登录' }, 401));
    const result = await get(f.cookie).expect(401);
    expect(result.body.code).toBe('AUTH_SESSION_REQUIRED');
    expect(result.body).not.toHaveProperty('sources');
    expect(result.body).not.toHaveProperty('context');
    expect(JSON.stringify(result.body)).not.toContain(f.home.name);
  });

  it('requires authentication and rejects ordinary business, supplier and foreign target access before reading any source', async () => {
    await request(app.getHttpServer()).get(path).expect(401);
    const business = await fixture(['workflow:act']);
    const supplier = await fixture(['platform:admin', 'audit:read'], 'SUPPLIER');
    const manager = await fixture(['workflow:manage']);
    const hidden = await organization();
    const audit = jest.spyOn(app.get(AuditQueryService), 'list');
    const outbox = jest.spyOn(app.get(OutboxAdministrationService), 'list');
    const organizations = jest.spyOn(app.get(OrganizationReconfigurationService), 'listPending');
    const users = jest.spyOn(app.get(AdminUserReconfigurationService), 'listPending');
    for (const response of [await get(business.cookie).expect(403), await get(supplier.cookie).expect(403), await get(manager.cookie, hidden.id).expect(403), await get(manager.cookie, randomUUID()).expect(403)]) {
      expect(response.body).not.toHaveProperty('sources');
      expect(response.body).not.toHaveProperty('context');
      expect(JSON.stringify(response.body)).not.toContain(hidden.name);
    }
    for (const owner of [audit, outbox, organizations, users]) expect(owner).not.toHaveBeenCalled();
  });

  it('does not retain a formerly authorized aggregate after the persisted grant is removed', async () => {
    const f = await fixture(['outbox:read', 'workflow:manage']);
    expect(source((await get(f.cookie).expect(200)).body, 'outbox').status).toBe('AVAILABLE');
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'outbox:read' } });
    await prisma.rolePermission.deleteMany({ where: { permissionId: permission.id, role: { organizationId: f.home.id } } });
    const owner = jest.spyOn(app.get(OutboxAdministrationService), 'list');
    expect((await get(f.cookie).expect(200)).body.sources).toEqual([]);
    expect(owner).not.toHaveBeenCalled();
    await prisma.session.updateMany({ where: { userId: f.user.id }, data: { revokedAt: new Date() } });
    await get(f.cookie).expect(401);
  });

  it.each(['organizationId=not-a-uuid', 'organizationId=', `organizationId=${randomUUID()}&organizationId=${randomUUID()}`, `organizationId=${randomUUID()}&actorId=${randomUUID()}`])('rejects malformed or spoofed home queries %s', async query => {
    const f = await fixture(['workflow:manage']);
    await request(app.getHttpServer()).get(`${path}?${query}`).set('Cookie', f.cookie).expect(400);
  });
});
