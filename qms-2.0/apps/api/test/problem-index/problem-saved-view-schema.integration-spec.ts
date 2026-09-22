import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { ProblemSavedViewModule } from '../../src/modules/problem-index/problem-saved-view.module.js';

if (!process.env.DATABASE_URL) throw new Error('Real PostgreSQL DATABASE_URL is required for personal problem views.');

describe('personal problem views on PostgreSQL', () => {
  const prisma = new PrismaService();
  const organizationIds: string[] = [];
  let app: INestApplication;

  beforeAll(async () => {
    await prisma.$connect();
    const module = await Test.createTestingModule({ imports: [AppModule, ProblemSavedViewModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(async () => {
    await prisma.problemSavedView.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.auditEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.session.deleteMany({ where: { user: { organizationId: { in: organizationIds } } } });
    await prisma.userRole.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.rolePermission.deleteMany({ where: { role: { organizationId: { in: organizationIds } } } });
    await prisma.role.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  async function fixture(accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Personal view fixture', type: accountType } });
    organizationIds.push(organization.id);
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'fixture', accountType } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Problem reader' } });
    const permission = await prisma.permission.upsert({ where: { code: 'problem-index:read' }, create: { code: 'problem-index:read', name: 'Read problems' }, update: {} });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    await prisma.userRole.create({ data: { userId: user.id, organizationId: organization.id, roleId: role.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true });
    const session = await app.get(SessionService).resolve(token);
    return { organization, user, role, session: session!, cookie: `qms_session=${token}; qms_csrf=view-csrf` };
  }

  const configuration = () => ({ schemaVersion: 1, filters: { status: 'OPEN', search: 'ZXPR-private-filter' }, sort: { sortBy: 'updatedAt', sortDirection: 'desc' },
    visibleColumns: ['reportNumber', 'status'], columnOrder: ['reportNumber', 'title', 'status'] });
  const body = () => ({ name: 'My pending problems', configuration: configuration() });
  function create(context: Awaited<ReturnType<typeof fixture>>, payload: unknown = body(), organizationId = context.organization.id) {
    return request(app.getHttpServer()).post(`/api/v1/problem-views?organizationId=${organizationId}`).set('Cookie', context.cookie).set('x-csrf-token', 'view-csrf').send(payload);
  }
  function update(context: Awaited<ReturnType<typeof fixture>>, id: string, payload: unknown, organizationId = context.organization.id) {
    return request(app.getHttpServer()).patch(`/api/v1/problem-views/${id}?organizationId=${organizationId}`).set('Cookie', context.cookie).set('x-csrf-token', 'view-csrf').send(payload);
  }
  function remove(context: Awaited<ReturnType<typeof fixture>>, id: string, expectedVersion: number, organizationId = context.organization.id) {
    return request(app.getHttpServer()).delete(`/api/v1/problem-views/${id}?organizationId=${organizationId}`).set('Cookie', context.cookie).set('x-csrf-token', 'view-csrf').send({ expectedVersion });
  }

  it('serves an authorized personal empty view list using a real session', async () => {
    const context = await fixture();
    const response = await request(app.getHttpServer()).get('/api/v1/problem-views').set('Cookie', context.cookie).expect(200);
    expect(response.body).toEqual({ items: [], total: 0 });
  });

  it('persists only personal preferences with CAS and excludes filter text from audit', async () => {
    const context = await fixture();
    const created = (await create(context).expect(201)).body;
    expect(created).toMatchObject({ name: body().name, organizationId: context.organization.id, configuration: configuration(), version: 1 });
    expect(created).not.toHaveProperty('ownerUserId');
    expect(await prisma.problemSavedView.findUnique({ where: { id: created.id } })).toMatchObject({ ownerUserId: context.user.id });
    const changed = (await update(context, created.id, { expectedVersion: 1, name: 'Renamed view' }).expect(200)).body;
    expect(changed).toMatchObject({ name: 'Renamed view', version: 2, configuration: configuration() });
    await remove(context, created.id, 1).expect(409);
    expect((await remove(context, created.id, 2).expect(200)).body).toEqual({ id: created.id, deleted: true });
    expect(await prisma.problemSavedView.findUnique({ where: { id: created.id } })).toBeNull();
    const audits = await prisma.auditEvent.findMany({ where: { resourceType: 'ProblemSavedView', resourceId: created.id } });
    expect(audits).toHaveLength(3);
    expect(JSON.stringify(audits)).not.toContain('ZXPR-private-filter');
    expect(audits.every((audit) => Object.keys(audit.metadata as object).every((key) => key === 'resourceVersion'))).toBe(true);
  });

  it('paginates only the owner and selected organization with a stable timestamp and ID order', async () => {
    const context = await fixture();
    const created = await Promise.all([create(context).expect(201), create(context).expect(201), create(context).expect(201)]);
    const ids = created.map((result) => result.body.id as string).sort().reverse();
    await prisma.problemSavedView.updateMany({ where: { id: { in: ids } }, data: { updatedAt: new Date('2026-09-19T00:00:00Z') } });
    const first = await request(app.getHttpServer()).get('/api/v1/problem-views?pageSize=2').set('Cookie', context.cookie).expect(200);
    const second = await request(app.getHttpServer()).get('/api/v1/problem-views?pageSize=2&offset=2').set('Cookie', context.cookie).expect(200);
    expect(first.body.total).toBe(3);
    expect([...first.body.items, ...second.body.items].map((view: { id: string }) => view.id)).toEqual(ids);
    expect((await request(app.getHttpServer()).get('/api/v1/problem-views?offset=10').set('Cookie', context.cookie).expect(200)).body).toEqual({ total: 3, items: [] });
  });

  it('allows an authorized internal owner to save separate views in another organization', async () => {
    const context = await fixture();
    const target = await fixture();
    await prisma.userRole.create({ data: { userId: context.user.id, roleId: target.role.id, organizationId: target.organization.id } });
    const created = (await create(context, body(), target.organization.id).expect(201)).body;
    expect(await prisma.problemSavedView.findUnique({ where: { id: created.id } })).toMatchObject({ organizationId: target.organization.id, ownerUserId: context.user.id });
    expect((await request(app.getHttpServer()).get('/api/v1/problem-views').set('Cookie', context.cookie).expect(200)).body.total).toBe(0);
    const scoped = await request(app.getHttpServer()).get(`/api/v1/problem-views?organizationId=${target.organization.id}`).set('Cookie', context.cookie).expect(200);
    expect(scoped.body.items).toHaveLength(1);
    await update(context, created.id, { expectedVersion: 1, name: 'Wrong organization' }).expect(404);
    await update(context, created.id, { expectedVersion: 1, name: 'Target view' }, target.organization.id).expect(200);
    await update(target, created.id, { expectedVersion: 2, name: 'Other owner' }).expect(404);
    await remove(target, created.id, 2).expect(404);
    expect((await request(app.getHttpServer()).get('/api/v1/problem-views').set('Cookie', target.cookie).expect(200)).body.total).toBe(0);
    const supplier = await fixture('SUPPLIER');
    await prisma.userRole.create({ data: { userId: supplier.user.id, roleId: target.role.id, organizationId: target.organization.id } });
    await create(supplier, body(), target.organization.id).expect(403);
    const unauthorized = await fixture();
    await create(unauthorized, body(), target.organization.id).expect(403);
  });

  it('allows only one writer at the same version and audits only the winner', async () => {
    const context = await fixture();
    const created = (await create(context).expect(201)).body;
    const results = await Promise.all(['First', 'Second'].map((name) => update(context, created.id, { expectedVersion: 1, name })));
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await prisma.problemSavedView.findUnique({ where: { id: created.id } })).toMatchObject({ version: 2 });
    expect(await prisma.auditEvent.count({ where: { resourceType: 'ProblemSavedView', resourceId: created.id, action: 'PROBLEM_VIEW_UPDATED' } })).toBe(1);
  });

  async function holdView(id: string) {
    let release!: () => void;
    let acquired!: (pid: number) => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<number>((resolve) => { acquired = resolve; });
    const holder = prisma.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM problem_saved_views WHERE id = ${id}::uuid FOR UPDATE`;
      acquired(backend!.pid);
      await released;
    }, { timeout: 15000 });
    return { pid: await ready, release: async () => { release(); await holder; } };
  }

  async function waitForBlocked(pid: number) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS waiting`);
      if (row!.waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Personal view mutation did not wait for its PostgreSQL lock');
  }

  it.each(['permission', 'session', 'disabled', 'security-version', 'organization'] as const)('rechecks %s after waiting for the view lock', async (change) => {
    const context = await fixture();
    const created = (await create(context).expect(201)).body;
    const held = await holdView(created.id);
    const pending = update(context, created.id, { expectedVersion: 1, name: 'Denied write' }).then((response) => response);
    try {
      await waitForBlocked(held.pid);
      if (change === 'permission') await prisma.userRole.deleteMany({ where: { userId: context.user.id } });
      if (change === 'session') await prisma.session.update({ where: { id: context.session.id }, data: { revokedAt: new Date() } });
      if (change === 'disabled') await prisma.user.update({ where: { id: context.user.id }, data: { status: 'DISABLED' } });
      if (change === 'security-version') await prisma.user.update({ where: { id: context.user.id }, data: { securityVersion: { increment: 1 } } });
      if (change === 'organization') await prisma.organization.update({ where: { id: context.organization.id }, data: { status: 'DISABLED' } });
    } finally { await held.release(); }
    expect((await pending).status).toBe(change === 'permission' ? 403 : 401);
    expect(await prisma.problemSavedView.findUnique({ where: { id: created.id } })).toMatchObject({ name: body().name, version: 1 });
    await request(app.getHttpServer()).get('/api/v1/problem-views').set('Cookie', context.cookie).expect(change === 'permission' ? 403 : 401);
  });

  it.each(['create', 'update', 'delete'] as const)('rolls back %s when its audit fails', async (operation) => {
    const context = await fixture();
    const created = (await create(context).expect(201)).body;
    const audit = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValue(new Error('view-audit-unavailable'));
    try {
      const result = operation === 'create' ? create(context) : operation === 'update' ? update(context, created.id, { expectedVersion: 1, name: 'Must roll back' }) : remove(context, created.id, 1);
      await result.expect(500);
    } finally { audit.mockRestore(); }
    expect(await prisma.problemSavedView.count({ where: { organizationId: context.organization.id } })).toBe(1);
    expect(await prisma.problemSavedView.findUnique({ where: { id: created.id } })).toMatchObject({ name: body().name, version: 1 });
  });

  it('rejects missing sessions, CSRF, invalid preferences and forged server fields', async () => {
    const context = await fixture();
    await request(app.getHttpServer()).get('/api/v1/problem-views').expect(401);
    await request(app.getHttpServer()).post('/api/v1/problem-views').set('Cookie', context.cookie).send(body()).expect(403);
    const invalid = [
      { ...body(), ownerUserId: context.user.id }, { ...body(), organizationId: context.organization.id }, { ...body(), name: ' ' }, { ...body(), name: 'x'.repeat(101) },
      ...[{ schemaVersion: 2 }, { script: 'return true' }, { url: 'https://example.test' }, { filters: { organizationId: context.organization.id } },
        { filters: { page: 1 } }, { filters: { sortBy: 'status' } }, { filters: { sql: 'SELECT * FROM users' } }, { filters: { ownerId: 'bad-id' } }, { filters: { status: null } },
        { filters: { dueFrom: '2026-09-20T00:00:00Z', dueTo: '2026-09-19T00:00:00Z' } }, { sort: { sortBy: 'pg_sleep(5)', sortDirection: 'asc' } },
        { sort: { sortBy: 'status', sortDirection: 'asc', sql: true } }, { visibleColumns: ['passwordHash'] }, { visibleColumns: ['status', 'status'] },
        { columnOrder: ['status', 'status'] }, { visibleColumns: ['ownerId'], columnOrder: ['reportNumber'] }, { filters: null }, { sort: [] },
      ].map((configurationPatch) => ({ ...body(), configuration: { ...configuration(), ...configurationPatch } })),
    ];
    for (const payload of invalid) await create(context, payload).expect(400);
    const created = (await create(context).expect(201)).body;
    await update(context, created.id, { expectedVersion: 1, name: null }).expect(400);
    await update(context, created.id, { expectedVersion: 1 }).expect(400);
    await update(context, created.id, { expectedVersion: 0, name: 'Invalid' }).expect(400);
    await request(app.getHttpServer()).delete(`/api/v1/problem-views/${created.id}`).set('Cookie', context.cookie).set('x-csrf-token', 'view-csrf').send({ expectedVersion: 1, force: true }).expect(400);
    for (const query of ['pageSize=101', 'offset=10001', 'ownerUserId=other', 'orderBy=sql']) await request(app.getHttpServer()).get(`/api/v1/problem-views?${query}`).set('Cookie', context.cookie).expect(400);
    expect(await prisma.problemSavedView.count({ where: { organizationId: context.organization.id } })).toBe(1);
  });
});
