import 'reflect-metadata';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { jest } from '@jest/globals';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthenticatedGuard } from '../../src/common/guards/authenticated.guard.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService, type RecordAuditEventInput } from '../../src/modules/audit-log/audit-log.service.js';
import { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { OrganizationScopeService } from '../../src/modules/organization/organization-scope.service.js';
import catalog from '../../src/modules/workbench-graph/workbench-catalog.json' with { type: 'json' };
import { WorkbenchGraphModule } from '../../src/modules/workbench-graph/workbench-graph.module.js';

describe('workbench graph HTTP contract', () => {
  let app: INestApplication;
  const node = catalog.nodes[0]!;
  const organization = { id: 'fixture-org', type: 'INTERNAL', status: 'ACTIVE', deletedAt: null, configurationRequired: false };
  const assignment = { organizationId: 'fixture-org', role: { id: 'admin-role', organizationId: 'fixture-org', permissions: [{ permission: { code: 'platform:admin' } }] } };
  type StatusRow = { nodeId: string; status: string; version: number; updatedAt: Date; evidence: string | null };
  let statusRow: StatusRow | null = null;
  let pending = false;
  let adminSessionRevoked = false;
  const audit = jest.fn(async (_input: RecordAuditEventInput, _transaction?: object) => {});
  const prisma = {
    userRole: { findMany: async ({ where }: { where: { userId: string } }) => where.userId === 'ADMIN' ? [assignment] : [] },
    userPosition: { findMany: async () => [] },
    user: { findUnique: async ({ where }: { where: { id: string } }) => ({
      id: where.id, accountType: 'INTERNAL', status: 'ACTIVE', organizationId: organization.id, organization,
      securityVersion: 1, mustChangePassword: false, mfaEnabled: false, mfaPreference: 'DEFAULT',
    }) },
    organization: { findMany: async () => [organization], findUnique: async () => organization },
    permission: { findMany: async () => [] },
    session: { findFirst: async ({ where }: { where: { id: string; userId: string; revokedAt: null; securityVersion: number } }) =>
      where.id === `session-${where.userId}` && where.revokedAt === null && where.securityVersion === 1
        && !(where.userId === 'ADMIN' && adminSessionRevoked) ? { mfaVerifiedAt: new Date() } : null },
    $queryRaw: async () => [{ ...organization, configurationRequired: pending }],
    workbenchGraphStatus: {
      findMany: async () => statusRow ? [statusRow] : [],
      findUnique: async () => statusRow,
      createMany: async ({ data }: { data: StatusRow }) => {
        if (statusRow) return { count: 0 };
        statusRow = data;
        return { count: 1 };
      },
      updateMany: async ({ where, data }: { where: { version: number }; data: StatusRow }) => {
        if (statusRow?.version !== where.version) return { count: 0 };
        statusRow = { ...statusRow, ...data };
        return { count: 1 };
      },
    },
    $transaction: async <Result>(fn: (transaction: object) => Promise<Result>) => fn(prisma),
  };

  beforeAll(async () => {
    const builder = Test.createTestingModule({
      imports: [DatabaseModule, WorkbenchGraphModule],
      providers: [
        { provide: APP_GUARD, useClass: AuthenticatedGuard },
        { provide: SessionService, useValue: { resolve: (token: string) =>
          ['INTERNAL', 'SUPPLIER', 'ADMIN'].includes(token) ? { id: `session-${token}`, user: {
            id: token, organizationId: 'fixture-org', accountType: token === 'SUPPLIER' ? token : 'INTERNAL',
          } } : null } },
        { provide: OrganizationScopeService, useValue: {} },
        { provide: AuthorizationService, useValue: {} },
        { provide: AuditLogService, useValue: { record: audit } },
      ],
    });
    builder.overrideProvider(PrismaService).useValue(prisma);
    builder.overrideProvider(AuditLogService).useValue({ record: audit });
    const module = await builder.compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  beforeEach(() => { statusRow = null; pending = false; adminSessionRevoked = false; audit.mockClear(); });
  afterAll(async () => app?.close());

  const path = '/api/v1/workbench/graph';
  const patch = (token: string, id = node.id) => request(app.getHttpServer())
    .patch(`${path}/nodes/${id}/status`).set('Cookie', `qms_session=${token}`);

  it('serves exactly the public catalog fields to an internal user without business grants', async () => {
    const { body } = await request(app.getHttpServer()).get(path).set('Cookie', 'qms_session=INTERNAL')
      .expect(200).expect('Cache-Control', 'no-store');
    expect(Object.keys(body).sort()).toEqual(['canEditStatus', 'nodes', 'relations', 'version']);
    expect(body.canEditStatus).toBe(false);
    expect(body.version).toBe(catalog.version);
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.relations.length).toBeGreaterThan(0);
    expect(body.nodes.map((node: { id: string }) => node.id)).toEqual(catalog.nodes.map(node => node.id));
    expect(body.relations.map((relation: { id: string }) => relation.id)).toEqual(catalog.relations.map(relation => relation.id));
    for (const node of body.nodes) {
      expect(Object.keys(node).sort()).toEqual(['aliases', 'domain', 'entry', 'guide', 'id', 'name', 'plan', 'status', 'statusUpdatedOn', 'statusVersion', 'summary']);
      expect(node.statusUpdatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(node.statusVersion).toBe(0);
      expect(Object.keys(node.guide).sort()).toEqual(['exceptions', 'prerequisites', 'result', 'role', 'steps', 'title', 'version']);
      expect(['idea', 'development', 'live']).toContain(node.status);
    }
    for (const relation of body.relations) {
      expect(Object.keys(relation).sort()).toEqual(['content', 'exceptions', 'from', 'id', 'kind', 'name', 'result', 'status', 'to', 'trigger']);
      expect(['data', 'configuration', 'handoff']).toContain(relation.kind);
      expect(['effective', 'configuration', 'planned', 'unverified']).toContain(relation.status);
    }
  });

  it('requires a valid session', async () => {
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).get(path).set('Cookie', 'qms_session=invalid').expect(401);
  });

  it('denies an authenticated supplier', async () => {
    await request(app.getHttpServer()).get(path).set('Cookie', 'qms_session=SUPPLIER').expect(403);
  });

  it('writes and audits an admin change, then exposes the same status to internal readers', async () => {
    const http = request(app.getHttpServer());
    const before = await http.get(path).set('Cookie', 'qms_session=ADMIN').expect(200);
    expect(before.body.canEditStatus).toBe(true);
    const { body } = await patch('ADMIN').send({ status: 'live', expectedVersion: 0, evidence: '  Issue #157  ' }).expect(200);
    expect(body).toMatchObject({ id: node.id, status: 'live', statusVersion: 1 });
    expect(body).not.toHaveProperty('evidence');
    expect(statusRow).toMatchObject({ evidence: 'Issue #157' });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'WORKBENCH_GRAPH_STATUS_UPDATED', resourceType: 'WorkbenchGraphNode', resourceId: node.id,
      actorUserId: 'ADMIN', organizationId: 'fixture-org', metadata: { status: 'live', previousStatus: node.status, resourceVersion: 1, evidence: 'Issue #157' } }), prisma);
    const graph = await http.get(path).set('Cookie', 'qms_session=INTERNAL').expect(200);
    expect(graph.body.nodes[0]).toEqual(body);
    expect(graph.body.nodes[1]).toMatchObject({ status: catalog.nodes[1]!.status, statusVersion: 0 });
    expect(graph.body.relations).toEqual(before.body.relations);
    await patch('ADMIN').send({ status: 'idea', expectedVersion: 0 }).expect(409);
    await patch('ADMIN').send({ status: 'idea', expectedVersion: 1 }).expect(200);
    expect(statusRow).toMatchObject({ status: 'idea', version: 2, evidence: null });
    expect(audit).toHaveBeenCalledTimes(2);
  });

  it('refuses ordinary, supplier, anonymous and configuration-pending writes', async () => {
    for (const [token, code] of [['INTERNAL', 403], ['SUPPLIER', 403], ['invalid', 401]] as const) {
      await patch(token).send({ status: 'idea', expectedVersion: 0 }).expect(code);
    }
    pending = true;
    await patch('ADMIN').send({ status: 'idea', expectedVersion: 0 }).expect(403);
    const { body } = await request(app.getHttpServer()).get(path).set('Cookie', 'qms_session=ADMIN').expect(200);
    expect(body.canEditStatus).toBe(false);
    expect(statusRow).toBeNull();
    expect(audit).not.toHaveBeenCalled();
  });

  it('refuses a write if the admin session is revoked after the guard', async () => {
    const transaction = jest.spyOn(prisma, '$transaction').mockImplementationOnce(async work => {
      adminSessionRevoked = true;
      return work(prisma);
    });
    try {
      const { status, body } = await patch('ADMIN').send({ status: 'idea', expectedVersion: 0 });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(status).toBe(401);
      expect(body.code).toBe('AUTH_SESSION_REQUIRED');
      expect(statusRow).toBeNull();
      expect(audit).not.toHaveBeenCalled();
    } finally { transaction.mockRestore(); }
  });

  it('refuses unknown nodes and invalid payloads without writing', async () => {
    await patch('ADMIN', 'not-in-catalog').send({ status: 'idea', expectedVersion: 0 }).expect(404);
    for (const invalid of [
      { status: 'optimized', expectedVersion: 0 }, { status: 'idea' }, { status: 'idea', expectedVersion: '0' },
      { status: 'idea', expectedVersion: -1 }, { status: 'idea', expectedVersion: 0.5 }, { status: 'idea', expectedVersion: 2147483648 },
      { status: 'live', expectedVersion: 0 }, { status: 'live', expectedVersion: 0, evidence: '   ' },
      { status: 'idea', expectedVersion: 0, evidence: null }, { status: 'idea', expectedVersion: 0, evidence: 'X'.repeat(501) },
      { status: 'idea', expectedVersion: 0, extra: true },
    ]) {
      await patch('ADMIN').send(invalid).expect(400);
    }
    expect(statusRow).toBeNull();
    expect(audit).not.toHaveBeenCalled();
  });

  it('preserves status evidence only in the authorized workbench audit event', () => {
    const sanitizer = new AuditLogService({ auditEvent: { create: async () => undefined } });
    const event = { action: 'WORKBENCH_GRAPH_STATUS_UPDATED', resourceType: 'WorkbenchGraphNode', outcome: 'SUCCESS' };
    const metadata = { status: 'live', previousStatus: 'development', resourceVersion: 1, evidence: 'Release & acceptance: Issue #157' };
    expect(sanitizer.safeMetadata({ ...metadata, arbitraryText: 'private data' }, event)).toEqual(metadata);
    expect(sanitizer.safeMetadata(metadata, { ...event, resourceType: 'OtherResource' })).toEqual({ status: 'live', resourceVersion: 1 });
    expect(sanitizer.safeMetadata(metadata, { ...event, outcome: 'DENIED' })).toEqual({ status: 'live', resourceVersion: 1 });
    expect(sanitizer.safeMetadata({ evidence: 'x'.repeat(501), previousStatus: 'invalid' }, event)).toEqual({});
  });
});
