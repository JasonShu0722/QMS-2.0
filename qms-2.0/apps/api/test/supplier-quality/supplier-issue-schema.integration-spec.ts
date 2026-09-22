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

if (!process.env.DATABASE_URL) throw new Error('Supplier issue integration requires real PostgreSQL; no skipping.');

describe('supplier issue transaction with real HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const csrf = randomUUID();

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => app?.close());

  async function context() {
    const owner = await prisma.organization.create({ data: { code: randomUUID(), name: 'Issue owner', type: 'INTERNAL' } });
    const supplier = await prisma.organization.create({ data: { code: randomUUID(), name: 'Issue supplier', type: 'SUPPLIER' } });
    const user = await prisma.user.create({ data: { organizationId: owner.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const role = await prisma.role.create({ data: { organizationId: owner.id, code: randomUUID(), name: 'Issue operator' } });
    for (const code of ['configuration:read', 'configuration:manage', 'supplier-quality:problems:read', 'supplier-quality:problems:write', 'workflow:start']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: owner.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const profile = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: owner.id, supplierOrganizationId: supplier.id, businessCode: randomUUID(), displayName: supplier.name } });
    await app.get(NumberingService).publishRuleVersion({ organizationId: owner.id, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}', createdById: user.id });
    const cookie = `qms_session=${token}; qms_csrf=${csrf}`;
    return { owner, supplier, user, profile, cookie };
  }

  async function flow(owner: Awaited<ReturnType<typeof context>>) {
    const definitions = app.get(WorkflowDefinitionService);
    const definition = await definitions.createDraft({ organizationId: owner.owner.id, userId: owner.user.id, code: randomUUID(), name: 'Supplier issue flow', draft: {
      nodes: [
        { id: 'reply', name: '供应商回复', type: 'ACTION', config: { isStart: true, slaMinutes: 90, assignment: { permission: 'supplier-quality:responses:write' } } },
        { id: 'verify', name: '内部验证', type: 'VERIFICATION', config: { assignment: { permission: 'supplier-quality:problems:write' } } },
        { id: 'close', name: '关闭', type: 'CLOSE', config: { isEnd: true, requireIndependentVerification: true, assignment: { permission: 'supplier-quality:problems:write' } } },
      ], transitions: [{ id: 'reply', from: 'reply', to: 'verify', action: 'SUBMIT' }, { id: 'verify', from: 'verify', to: 'close', action: 'VERIFY' }],
    } });
    return definitions.publishVersion({ organizationId: owner.owner.id, userId: owner.user.id, definitionId: definition.id });
  }

  async function draft(owner: Awaited<ReturnType<typeof context>>) {
    const body = { profileId: owner.profile.id, title: '需正式发单的问题', materialCode: 'MAT-ISSUE', defectDescription: '发现批次缺陷', defectQuantity: 4, severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER' };
    const response = await request(app.getHttpServer()).post('/api/v1/supplier-quality/drafts').set('Cookie', owner.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body).expect(201);
    return response.body as { id: string; version: number };
  }

  async function bind(owner: Awaited<ReturnType<typeof context>>, workflowVersionId: string) {
    return request(app.getHttpServer()).put('/api/v1/supplier-quality/workflow-bindings').set('Cookie', owner.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER', expectedVersion: 0, workflowVersionId, enabled: true }).expect(200);
  }

  function issue(owner: Awaited<ReturnType<typeof context>>, id: string, expectedVersion = 1, key = randomUUID()) {
    const test = request(app.getHttpServer()).post(`/api/v1/supplier-quality/drafts/${id}/issue`).set('Cookie', owner.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send({ expectedVersion });
    return test;
  }

  it('creates index, starts the fixed workflow and releases a supplier problem atomically', async () => {
    const owner = await context(); const version = await flow(owner); const binding = await bind(owner, version.id); const record = await draft(owner);
    const response = await issue(owner, record.id).expect(201);
    expect(response.body).toMatchObject({ id: record.id, stage: 'ISSUED', responseForm: 'BRIEF', replyMode: 'SUPPLIER' });
    const domain = await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: record.id } });
    const index = await prisma.problemIndex.findUniqueOrThrow({ where: { id: domain.problemIndexId! } });
    expect(domain.workflowBindingId).toBe(binding.body.id);
    expect(domain.workflowBindingVersion).toBe(1);
    expect(domain.releasedToSupplierAt).not.toBeNull();
    expect(index.workflowInstanceId).not.toBeNull();
    expect(index.dueAt).not.toBeNull();
    expect(await prisma.workflowInstance.count({ where: { problemIndexId: index.id } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: { in: [index.id, index.workflowInstanceId!] } } })).toBeGreaterThanOrEqual(2);
  });

  it('rejects missing binding without leaving an index or release fact', async () => {
    const owner = await context(); const record = await draft(owner);
    await issue(owner, record.id).expect(409);
    expect(await prisma.problemIndex.count({ where: { sourceId: record.id } })).toBe(0);
    expect((await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: record.id } })).releasedToSupplierAt).toBeNull();
  });

  it('replays the same issue key and rejects changed payloads or concurrent issuers', async () => {
    const owner = await context(); const version = await flow(owner); await bind(owner, version.id); const record = await draft(owner); const key = randomUUID();
    const first = await issue(owner, record.id, 1, key).expect(201);
    expect((await issue(owner, record.id, 1, key).expect(201)).body).toEqual(first.body);
    await issue(owner, record.id, 2, key).expect(409);
    await issue(owner, record.id, 1).expect(409);
    expect(await prisma.problemIndex.count({ where: { sourceId: record.id } })).toBe(1);
    const index = await prisma.problemIndex.findFirstOrThrow({ where: { sourceId: record.id } });
    expect(await prisma.workflowInstance.count({ where: { problemIndexId: index.id } })).toBe(1);
  });

  it('rolls back the index and workflow when the final issue audit fails', async () => {
    const owner = await context(); const version = await flow(owner); await bind(owner, version.id); const record = await draft(owner);
    const audit = app.get(AuditLogService); const original = audit.record.bind(audit);
    const spy = jest.spyOn(audit, 'record').mockImplementation(async (input, transaction) => {
      if (input.action === 'SUPPLIER_PROBLEM_ISSUED') throw new Error('issue audit failure');
      return original(input, transaction);
    });
    try { await issue(owner, record.id).expect(500); } finally { spy.mockRestore(); }
    expect(await prisma.problemIndex.count({ where: { sourceId: record.id } })).toBe(0);
    expect(await prisma.workflowInstance.count({ where: { instanceKey: record.id } })).toBe(0);
    const domain = await prisma.supplierQualityProblem.findUniqueOrThrow({ where: { id: record.id } });
    expect(domain.problemIndexId).toBeNull();
    expect(domain.workflowBindingId).toBeNull();
    expect(domain.releasedToSupplierAt).toBeNull();
  });
});
