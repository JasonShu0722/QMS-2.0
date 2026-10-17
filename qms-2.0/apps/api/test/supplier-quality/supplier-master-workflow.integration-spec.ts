import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { jest } from '@jest/globals';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';

if (!process.env.DATABASE_URL) throw new Error('Supplier master workflow requires real PostgreSQL.');

describe('independent supplier workflow and owner-local lazy snapshots', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const csrf = randomUUID();
  const owners: string[] = [];
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    if (prisma && owners.length) {
      const indexes = await prisma.problemIndex.findMany({ where: { organizationId: { in: owners } }, select: { id: true } });
      const instances = await prisma.workflowInstance.findMany({ where: { organizationId: { in: owners } }, select: { id: true } });
      const tasks = await prisma.workflowTask.findMany({ where: { organizationId: { in: owners } }, select: { id: true } });
      await prisma.outboxEvent.deleteMany({ where: { OR: [
        { aggregateType: 'ProblemIndex', aggregateId: { in: indexes.map(({ id }) => id) } },
        { aggregateType: 'WorkflowInstance', aggregateId: { in: instances.map(({ id }) => id) } },
        { aggregateType: 'WorkflowTask', aggregateId: { in: tasks.map(({ id }) => id) } },
      ] } });
    }
    await app?.close();
  });

  async function context() {
    const owner = await prisma.organization.create({ data: { code: `F1-FLOW-${randomUUID()}`, name: 'Independent supplier workflow owner', type: 'INTERNAL' } });
    owners.push(owner.id);
    const role = await prisma.role.create({ data: { organizationId: owner.id, code: 'F1_FLOW', name: 'F1 workflow operator' } });
    for (const code of ['configuration:read', 'configuration:manage', 'supplier-quality:profiles:read', 'supplier-quality:profiles:write', 'supplier-quality:problems:read', 'supplier-quality:problems:write', 'supplier-quality:responses:write', 'workflow:start', 'workflow:act', 'account:users:create', 'account:users:read', 'account:users:reset', 'account:users:status']) {
      const permission = await prisma.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    const people = [];
    for (let index = 0; index < 2; index++) {
      const user = await prisma.user.create({ data: { organizationId: owner.id, username: `f1-flow-${randomUUID()}`, accountType: 'INTERNAL', passwordHash: 'unused' } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: owner.id } });
      people.push({ user, cookie: `qms_session=${await app.get(SessionService).create(user.id, prisma, { mfaVerified: true, reauthenticated: true })}; qms_csrf=${csrf}` });
    }
    const operator = people[0]!;
    const profile = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: owner.id, businessCode: randomUUID(), displayName: 'Independent supplier' } });
    await app.get(NumberingService).publishRuleVersion({ organizationId: owner.id, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}', createdById: operator.user.id });
    return { owner, profile, operator, verifier: people[1]! };
  }
  type Context = Awaited<ReturnType<typeof context>>;
  function post(cookie: string, path: string, body: object, key = randomUUID()) {
    return request(app.getHttpServer()).post(`/api/v1/supplier-quality/${path}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }
  async function prepareFlow(context: Context, replyMode: 'INTERNAL' | 'SUPPLIER') {
    const definitions = app.get(WorkflowDefinitionService);
    const definition = await definitions.createDraft({ organizationId: context.owner.id, userId: context.operator.user.id, code: randomUUID(), name: 'Independent supplier flow', draft: {
      nodes: [
        { id: 'reply', name: 'Reply', type: 'ACTION', config: { isStart: true, slaMinutes: 90, assignment: { permission: 'supplier-quality:responses:write' } } },
        { id: 'verify', name: 'Verify', type: 'VERIFICATION', config: { assignment: { permission: 'supplier-quality:problems:write' } } },
        { id: 'close', name: 'Close', type: 'CLOSE', config: { isEnd: true, requireIndependentVerification: true, assignment: { permission: 'supplier-quality:problems:write' } } },
      ], transitions: [{ id: 'reply', from: 'reply', to: 'verify', action: 'SUBMIT' }, { id: 'verify', from: 'verify', to: 'close', action: 'VERIFY' }],
    } });
    const version = await definitions.publishVersion({ organizationId: context.owner.id, userId: context.operator.user.id, definitionId: definition.id });
    await request(app.getHttpServer()).put('/api/v1/supplier-quality/workflow-bindings').set('Cookie', context.operator.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ severity: 'HIGH', responseForm: 'BRIEF', replyMode, expectedVersion: 0, workflowVersionId: version.id, enabled: true }).expect(200);
  }
  async function draft(context: Context, replyMode: 'INTERNAL' | 'SUPPLIER') {
    return (await post(context.operator.cookie, 'drafts', { profileId: context.profile.id, title: 'Independent supplier problem', materialCode: 'MAT-NULL', defectDescription: 'Defect', defectQuantity: 1, severity: 'HIGH', responseForm: 'BRIEF', replyMode, ...(replyMode === 'INTERNAL' ? { internalResponderId: context.operator.user.id } : {}) }).expect(201)).body;
  }

  async function firstLogin(account: { username: string; temporaryPassword: { temporaryPassword: string } }) {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ identifier: account.username, password: account.temporaryPassword.temporaryPassword }).expect(200);
    expect(login.body.securityState).toBe('PASSWORD_CHANGE_REQUIRED');
    const challenge = (login.headers['set-cookie'] as string[]).find((value) => value.startsWith('qms_password_change='))!.split(';')[0];
    const completed = await request(app.getHttpServer()).post('/api/v1/auth/password-change/complete').set('Cookie', `${challenge}; qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ newPassword: `Changed-${randomUUID()}` }).expect(200);
    expect(completed.body.securityState).toBe('AUTHENTICATED');
    return (completed.headers['set-cookie'] as string[]).find((value) => value.startsWith('qms_session=') && !value.startsWith('qms_session=;'))!.split(';')[0]!;
  }

  it('completes an internal-only issue, reply, independent verification and closure without a supplier enterprise', async () => {
    const ctx = await context();
    await prepareFlow(ctx, 'INTERNAL');
    const record = await draft(ctx, 'INTERNAL');
    const issued = (await post(ctx.operator.cookie, `drafts/${record.id}/issue`, { expectedVersion: record.version }).expect(201)).body;
    expect(issued.supplierOrganizationId).toBeNull();
    const submitted = (await post(ctx.operator.cookie, `problems/${record.id}/actions`, { expectedContentVersion: issued.version, content: { rootCause: 'Root', correctiveAction: 'Corrective', completionTime: new Date().toISOString() } }).expect(201)).body;
    await post(ctx.verifier.cookie, `problems/${record.id}/workflow-actions`, { action: 'VERIFY', expectedContentVersion: submitted.version, accepted: true }).expect(200);
    await post(ctx.operator.cookie, `problems/${record.id}/workflow-actions`, { action: 'CLOSE', expectedContentVersion: submitted.version }).expect(200);
    const current = await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: record.id } });
    expect(current.releasedToSupplierAt).toBeNull();
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id: current.problemIndexId! } })).status).toBe('CLOSED');
    expect((await prisma.supplierBusinessProfile.findUniqueOrThrow({ where: { id: ctx.profile.id } })).supplierOrganizationId).toBeNull();
  });

  it('binds only the current owner draft when issuing, not during account provisioning', async () => {
    const ctx = await context();
    await prepareFlow(ctx, 'SUPPLIER');
    const first = await draft(ctx, 'SUPPLIER');
    const untouched = await draft(ctx, 'SUPPLIER');
    const account = (await post(ctx.operator.cookie, `profiles/${ctx.profile.id}/accounts`, { username: `f1-lazy-${randomUUID()}` }).expect(201)).body;
    expect((await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: first.id } })).supplierOrganizationId).toBeNull();
    const issued = (await post(ctx.operator.cookie, `drafts/${first.id}/issue`, { expectedVersion: first.version }).expect(201)).body;
    expect(issued.supplierOrganizationId).toBe(account.organizationId);
    expect((await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: first.id } })).releasedToSupplierAt).not.toBeNull();
    expect((await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: untouched.id } })).supplierOrganizationId).toBeNull();
  });

  it('rolls back its lazy snapshot together with the issue workflow if final auditing fails', async () => {
    const ctx = await context();
    await prepareFlow(ctx, 'SUPPLIER');
    const record = await draft(ctx, 'SUPPLIER');
    await post(ctx.operator.cookie, `profiles/${ctx.profile.id}/accounts`, { username: `f1-rollback-${randomUUID()}` }).expect(201);
    const audit = app.get(AuditLogService);
    const original = audit.record.bind(audit);
    const spy = jest.spyOn(audit, 'record').mockImplementation(async (input, tx) => {
      if (input.action === 'SUPPLIER_PROBLEM_ISSUED') throw new Error('F1 issue audit failure');
      return original(input, tx);
    });
    try { await post(ctx.operator.cookie, `drafts/${record.id}/issue`, { expectedVersion: record.version }).expect(500); } finally { spy.mockRestore(); }
    expect((await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: record.id } })).supplierOrganizationId).toBeNull();
    expect(await prisma.problemIndex.count({ where: { sourceId: record.id } })).toBe(0);
    expect(await prisma.workflowInstance.count({ where: { instanceKey: record.id } })).toBe(0);
  });

  it('gives two staff the same portal boundary after real first-login changes and isolates another supplier', async () => {
    const a = await context();
    const b = await context();
    await prepareFlow(a, 'SUPPLIER');
    await prepareFlow(b, 'SUPPLIER');
    const accounts = [];
    for (const ctx of [a, a, b]) accounts.push((await post(ctx.operator.cookie, `profiles/${ctx.profile.id}/accounts`, { username: `f1-portal-${randomUUID()}` }).expect(201)).body);
    const cookies = [];
    for (const account of accounts) cookies.push(await firstLogin(account));
    const aDraft = await draft(a, 'SUPPLIER');
    const bDraft = await draft(b, 'SUPPLIER');
    const aProblem = (await post(a.operator.cookie, `drafts/${aDraft.id}/issue`, { expectedVersion: aDraft.version }).expect(201)).body;
    const bProblem = (await post(b.operator.cookie, `drafts/${bDraft.id}/issue`, { expectedVersion: bDraft.version }).expect(201)).body;
    const get = (cookie: string, id: string) => request(app.getHttpServer()).get(`/api/v1/supplier-portal/problems/${id}`).set('Cookie', cookie);
    await get(cookies[0]!, aProblem.id).expect(200);
    await get(cookies[1]!, aProblem.id).expect(200);
    await get(cookies[2]!, aProblem.id).expect(404);
    await get(cookies[0]!, bProblem.id).expect(404);
    const submit = (cookie: string, id: string, expectedContentVersion: number) => request(app.getHttpServer()).post(`/api/v1/supplier-portal/problems/${id}/actions`).set('Cookie', `${cookie}; qms_csrf=${csrf}`).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedContentVersion, content: { rootCause: 'Root cause', correctiveAction: 'Supplier action', completionTime: new Date().toISOString() } });
    await submit(cookies[2]!, aProblem.id, aProblem.version).expect(404);
    await submit(cookies[0]!, aProblem.id, aProblem.version).expect(201);
    expect(await prisma.supplierResponseRevision.count({ where: { problemId: aProblem.id, submittedById: accounts[0]!.id } })).toBe(1);
    await request(app.getHttpServer()).put(`/api/v1/supplier-quality/profiles/${a.profile.id}/accounts/${accounts[0]!.id}/status`).set('Cookie', a.operator.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ status: 'DISABLED', expectedSecurityVersion: 2 }).expect(200);
    await get(cookies[0]!, aProblem.id).expect(401);
    await get(cookies[1]!, aProblem.id).expect(200);
    expect(await prisma.userTemporaryPassword.count({ where: { userId: { in: accounts.map(({ id }) => id) } } })).toBe(0);
  });
});
