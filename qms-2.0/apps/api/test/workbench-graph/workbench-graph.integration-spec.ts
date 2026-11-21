import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { SESSION_COOKIE, SessionService } from '../../src/modules/identity/session.service.js';
import catalog from '../../src/modules/workbench-graph/workbench-catalog.json' with { type: 'json' };
import { WorkbenchGraphService } from '../../src/modules/workbench-graph/workbench-graph.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('Workbench graph requires disposable loopback PostgreSQL; preview 55440 is forbidden.');
}

jest.setTimeout(60_000);

describe('workbench graph with persisted sessions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const organizationIds: string[] = [];
  const path = '/api/v1/workbench/graph';
  const node = catalog.nodes.find(node => node.id === 'production-batches')!;
  const nodePath = `${path}/nodes/${node.id}/status`;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      if (prisma && organizationIds.length) {
        const scope = { organizationId: { in: organizationIds } };
        await prisma.auditEvent.deleteMany({ where: scope });
        await prisma.user.deleteMany({ where: scope });
        await prisma.role.deleteMany({ where: scope });
        await prisma.organization.deleteMany({ where: { id: scope.organizationId } });
      }
    } finally { await app?.close(); }
  });

  async function organization(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'Workbench graph fixture', type } });
    organizationIds.push(org.id);
    return org;
  }

  async function identity(org: Awaited<ReturnType<typeof organization>>, admin = false) {
    const user = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), accountType: org.type, passwordHash: 'not-a-login-fixture' } });
    if (admin) {
      const marker = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
      const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Platform admin fixture', permissions: { create: { permissionId: marker.id } } } });
      await prisma.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: role.id } });
    }
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: admin, reauthenticated: admin });
    const csrf = randomUUID();
    return { user, csrf, token, cookie: `${SESSION_COOKIE}=${token}; qms_csrf=${csrf}` };
  }

  it('serves the same complete graph to staff and platform admin without granting admin access', async () => {
    const org = await organization();
    const staff = await identity(org);
    const admin = await identity(org, true);
    const http = request(app.getHttpServer());
    const staffGraph = await http.get(path).set('Cookie', staff.cookie).expect(200).expect('Cache-Control', 'no-store');
    const adminGraph = await http.get(path).set('Cookie', admin.cookie).expect(200).expect('Cache-Control', 'no-store');
    expect(staffGraph.body).toEqual({ ...adminGraph.body, canEditStatus: false });
    expect(adminGraph.body.canEditStatus).toBe(true);
    expect(staffGraph.body.nodes.length).toBeGreaterThan(0);
    const guardedRoute = '/api/v1/admin/integrations/endpoints';
    await http.get(guardedRoute).set('Cookie', staff.cookie).expect(403);
    await http.get(guardedRoute).set('Cookie', admin.cookie).expect(200);
  });

  it('rejects unauthenticated and supplier identities', async () => {
    const supplier = await identity(await organization('SUPPLIER'));
    const http = request(app.getHttpServer());
    await http.get(path).expect(401);
    await http.get(path).set('Cookie', supplier.cookie).expect(403);
  });

  it('enforces admin authorization and valid CSRF, commits one concurrent write and rolls back on audit failure', async () => {
    const org = await organization();
    const staff = await identity(org);
    const admin = await identity(org, true);
    const supplier = await identity(await organization('SUPPLIER'));
    const http = request(app.getHttpServer());
    const patch = (identity: { cookie: string; csrf: string }, target = nodePath) =>
      http.patch(target).set('Cookie', identity.cookie).set('x-csrf-token', identity.csrf);
    const payload = { status: 'live', expectedVersion: 0, evidence: 'Isolated graph fixture: release and acceptance evidence' };
    const scope = { organizationId: org.id, resourceType: 'WorkbenchGraphNode', resourceId: node.id, action: 'WORKBENCH_GRAPH_STATUS_UPDATED' };
    expect(await prisma.workbenchGraphStatus.findUnique({ where: { nodeId: node.id } })).toBeNull();
    await http.patch(nodePath).set('Cookie', admin.cookie).send(payload).expect(403);
    await patch(staff).send(payload).expect(403);
    await patch(supplier).send(payload).expect(403);
    await patch(admin, `${path}/nodes/not-in-catalog/status`).send(payload).expect(404);
    await patch(admin).send({ ...payload, status: 'optimized' }).expect(400);
    await patch(admin).send({ ...payload, evidence: ' ' }).expect(400);
    expect(await prisma.workbenchGraphStatus.findUnique({ where: { nodeId: node.id } })).toBeNull();

    const pendingOrg = await organization();
    const pendingAdmin = await identity(pendingOrg, true);
    await prisma.organization.update({ where: { id: pendingOrg.id }, data: { status: 'DISABLED', configurationRequired: true } });
    await http.get(path).set('Cookie', pendingAdmin.cookie).expect(401);
    await patch(pendingAdmin).send(payload).expect(401);

    try {
      const concurrent = await Promise.all([patch(admin).send(payload), patch(admin).send(payload)]);
      expect(concurrent.map(response => response.status).sort()).toEqual([200, 409]);
      const success = concurrent.find(response => response.status === 200)!;
      expect(success.body).toMatchObject({ id: node.id, status: 'live', statusVersion: 1 });
      const saved = await prisma.workbenchGraphStatus.findUniqueOrThrow({ where: { nodeId: node.id } });
      expect(saved).toMatchObject({ status: 'live', version: 1, evidence: payload.evidence });
      const events = await prisma.auditEvent.findMany({ where: scope });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ actorUserId: admin.user.id, outcome: 'SUCCESS', createdAt: expect.any(Date),
        metadata: { status: 'live', previousStatus: node.status, resourceVersion: 1, evidence: payload.evidence } });
      const reader = await http.get(path).set('Cookie', staff.cookie).expect(200);
      expect(reader.body.nodes.find((entry: { id: string }) => entry.id === node.id)).toEqual(success.body);

      const audit = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('audit write fixture failure'));
      try {
        await patch(admin).send({ status: 'idea', expectedVersion: 1 }).expect(500);
      } finally { audit.mockRestore(); }
      expect(await prisma.workbenchGraphStatus.findUnique({ where: { nodeId: node.id } })).toEqual(saved);
      expect(await prisma.auditEvent.count({ where: scope })).toBe(1);
      await patch(admin).send({ status: 'idea', expectedVersion: 1 }).expect(200);
      await patch(admin).send({ status: 'development', expectedVersion: 1 }).expect(409);
      expect(await prisma.workbenchGraphStatus.findUnique({ where: { nodeId: node.id } })).toMatchObject({ status: 'idea', version: 2, evidence: null });
      expect(await prisma.auditEvent.findUnique({ where: { id: events[0]!.id } })).toMatchObject({ metadata: { evidence: payload.evidence } });
    } finally { await prisma.workbenchGraphStatus.deleteMany({ where: { nodeId: node.id } }); }
  });

  it('does not persist or audit a status change when logout wins after the guard', async () => {
    const org = await organization();
    const admin = await identity(org, true);
    const where = { nodeId: node.id };
    const scope = { organizationId: org.id, resourceType: 'WorkbenchGraphNode', resourceId: node.id, action: 'WORKBENCH_GRAPH_STATUS_UPDATED' };
    expect(await prisma.workbenchGraphStatus.findUnique({ where })).toBeNull();

    const graph = app.get(WorkbenchGraphService);
    const update = graph.updateNodeStatus.bind(graph);
    const beforeWrite = jest.spyOn(graph, 'updateNodeStatus').mockImplementationOnce(async (...args) => {
      await app.get(SessionService).revoke(admin.token);
      return update(...args);
    });
    try {
      const { status, body } = await request(app.getHttpServer()).patch(nodePath).set('Cookie', admin.cookie)
        .set('x-csrf-token', admin.csrf).send({ status: 'idea', expectedVersion: 0 });
      expect(beforeWrite).toHaveBeenCalledTimes(1);
      expect(status).toBe(401);
      expect(body.code).toBe('AUTH_SESSION_REQUIRED');
      expect(await prisma.workbenchGraphStatus.findUnique({ where })).toBeNull();
      expect(await prisma.auditEvent.count({ where: scope })).toBe(0);
    } finally {
      beforeWrite.mockRestore();
      await prisma.workbenchGraphStatus.deleteMany({ where });
    }
  });

  it.each(['disabled user', 'mandatory password change', 'disabled organization'] as const)('rejects an existing session after %s', async (condition) => {
    const org = await organization();
    const { user, cookie } = await identity(org);
    const http = request(app.getHttpServer());
    await http.get(path).set('Cookie', cookie).expect(200);
    if (condition === 'disabled organization') {
      await prisma.organization.update({ where: { id: org.id }, data: { status: 'DISABLED' } });
    } else {
      await prisma.user.update({ where: { id: user.id }, data: condition === 'disabled user' ? { status: 'DISABLED' } : { mustChangePassword: true } });
    }
    await http.get(path).set('Cookie', cookie).expect(401);
  });
});
