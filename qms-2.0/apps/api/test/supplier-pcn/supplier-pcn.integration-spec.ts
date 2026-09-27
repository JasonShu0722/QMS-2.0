import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { SupplierPcnModule } from '../../src/modules/supplier-pcn/supplier-pcn.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';

if (!process.env.DATABASE_URL || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('PCN tests require disposable PostgreSQL.');

describe('supplier PCN application and approval', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID();
  const csrf = randomUUID();
  const organizations: string[] = [];
  const users: { id: string; cookie: string; roleId: string }[] = [];
  let profileId: string;
  let workflowDefinitionId: string;
  let workflowVersionId: string;
  const facts = { changeType: 'MATERIAL', title: '原料牌号变更', materialCode: 'MAT-01', beforeChange: '旧原料', afterChange: '新原料', reason: '供货调整', riskControl: '首批验证及隔离', plannedDate: '2026-10-15' };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule, SupplierPcnModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    for (const [index, accountType] of (['INTERNAL', 'SUPPLIER', 'INTERNAL', 'SUPPLIER', 'INTERNAL'] as const).entries()) {
      const organization = await prisma.organization.create({ data: { code: `PCN-${index}-${suffix}`, name: `PCN 组织 ${index}`, type: accountType } });
      organizations.push(organization.id);
      const user = await prisma.user.create({ data: { organizationId: organization.id, username: `pcn-${index}-${suffix}`, accountType, passwordHash: 'unused-test-hash' } });
      const role = await prisma.role.create({ data: { organizationId: organization.id, code: 'PCN_TEST', name: 'PCN 测试授权' } });
      const permissions = index === 4 ? [] : accountType === 'INTERNAL' ? ['supplier-pcn:requests:read', 'supplier-pcn:requests:approve', 'workflow:start', 'workflow:act'] : ['supplier-pcn:submissions:read', 'supplier-pcn:submissions:write', 'workflow:act'];
      for (const code of permissions) {
        const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      }
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: organization.id } });
      users.push({ id: user.id, roleId: role.id, cookie: `qms_session=${await app.get(SessionService).create(user.id, prisma, { reauthenticated: true })}; qms_csrf=${csrf}` });
    }
    profileId = (await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: organizations[0]!, supplierOrganizationId: organizations[1]!, businessCode: `PCN-${suffix}`, displayName: '供应商甲' } })).id;
    await new NumberingService(prisma).publishRuleVersion({ organizationId: organizations[0]!, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}', createdById: users[0]!.id });
    const definition = await prisma.workflowDefinition.create({ data: { organizationId: organizations[0]!, code: `PCN-${suffix}`, name: 'PCN 审批', createdById: users[0]!.id } });
    workflowDefinitionId = definition.id;
    const version = await prisma.workflowVersion.create({ data: { organizationId: organizations[0]!, workflowDefinitionId: definition.id, version: 1, status: 'PUBLISHED', publishedAt: new Date(), publishedById: users[0]!.id } });
    workflowVersionId = version.id;
    const supplierNode = await prisma.workflowNode.create({ data: { organizationId: organizations[0]!, workflowVersionId: version.id, nodeKey: 'supplier', name: '供应商提交', type: 'ACTION', config: { isStart: true, assignment: { permission: 'supplier-pcn:submissions:write' } } } });
    const approvalNode = await prisma.workflowNode.create({ data: { organizationId: organizations[0]!, workflowVersionId: version.id, nodeKey: 'approve', name: '内部审批', type: 'APPROVAL', config: { assignment: { permission: 'supplier-pcn:requests:approve' } } } });
    const closeNode = await prisma.workflowNode.create({ data: { organizationId: organizations[0]!, workflowVersionId: version.id, nodeKey: 'close', name: '关闭', type: 'CLOSE', config: { isEnd: true, assignment: { permission: 'supplier-pcn:requests:approve' } } } });
    await prisma.workflowTransition.createMany({ data: [
      { organizationId: organizations[0]!, workflowVersionId: version.id, transitionKey: 'submit', fromNodeId: supplierNode.id, toNodeId: approvalNode.id, action: 'SUBMIT' },
      { organizationId: organizations[0]!, workflowVersionId: version.id, transitionKey: 'approve', fromNodeId: approvalNode.id, toNodeId: closeNode.id, action: 'APPROVE' },
      { organizationId: organizations[0]!, workflowVersionId: version.id, transitionKey: 'return', fromNodeId: approvalNode.id, toNodeId: supplierNode.id, action: 'RETURN' },
    ] });
  });
  afterAll(async () => { await app?.close(); });
  function post(user: number, path: string, body: object, key = randomUUID()) {
    return request(app.getHttpServer()).post(`/api/v1/${path}`).set('Cookie', users[user]!.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }
  async function create(changeType = 'MATERIAL') {
    const response = await post(1, 'supplier-portal/pcns', { profileId, ...facts, changeType }).expect(201);
    expect(response.body).toMatchObject({ status: 'DRAFT', version: 1, supplierOrganizationId: organizations[1] });
    return response.body as { id: string; version: number };
  }
  async function file(id: string, clean = true) {
    return prisma.fileObject.create({ data: { organizationId: organizations[1]!, resourceType: 'supplier-pcn', resourceId: id, resourceVersion: 1, uploadedById: users[1]!.id, objectKey: randomUUID(), originalName: 'pcn.pdf', contentType: 'application/pdf', sizeBytes: 12, sha256: 'a'.repeat(64), verifiedSha256: clean ? 'a'.repeat(64) : null, verifiedContentType: clean ? 'application/pdf' : null, verifiedSizeBytes: clean ? 12 : null, objectVersionId: 'pcn-test-version', uploadCompletedAt: new Date(), uploadExpiresAt: new Date(Date.now() + 60000), scannedAt: clean ? new Date() : null, scannerEngine: clean ? 'ClamAV test' : null, scanStatus: clean ? 'CLEAN' : 'PENDING', status: clean ? 'AVAILABLE' : 'QUARANTINED', retainUntil: new Date(Date.now() + 86400000) } });
  }
  async function submitted() {
    const pcn = await create();
    const evidence = await file(pcn.id);
    await post(1, `supplier-portal/pcns/${pcn.id}/submit`, { expectedVersion: 1, fileId: evidence.id }).expect(201);
    return { ...pcn, fileId: evidence.id };
  }
  async function started() {
    const pcn = await submitted();
    const start = await post(0, `supplier-pcn/requests/${pcn.id}/start`, { expectedVersion: 2, workflowDefinitionId, workflowVersionId }).expect(201);
    expect(start.body.workflow).toMatchObject({ nodeType: 'ACTION', version: 1 });
    return { ...pcn, version: 3 };
  }
  async function advanced() {
    const pcn = await started();
    const detail = await request(app.getHttpServer()).get(`/api/v1/supplier-portal/pcns/${pcn.id}`).set('Cookie', users[1]!.cookie).expect(200);
    await post(1, `supplier-portal/pcns/${pcn.id}/advance`, { expectedVersion: 3, fileId: pcn.fileId,
      expectedWorkflowVersion: detail.body.workflow.version, expectedProblemVersion: detail.body.workflow.problemVersion, currentNodeId: detail.body.workflow.currentNodeId }).expect(201);
    return pcn;
  }
  it.each(['MATERIAL', 'PROCESS', 'EQUIPMENT', 'SITE'])('supports %s applications and isolates supplier and owner organizations', async (changeType) => {
    const pcn = await create(changeType);
    await request(app.getHttpServer()).get(`/api/v1/supplier-portal/pcns/${pcn.id}`).set('Cookie', users[3]!.cookie).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/supplier-pcn/requests/${pcn.id}`).set('Cookie', users[2]!.cookie).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/supplier-pcn/requests/${pcn.id}`).set('Cookie', users[4]!.cookie).expect(403);
    await post(3, 'supplier-portal/pcns', { profileId, ...facts }).expect(404);
    await request(app.getHttpServer()).get('/api/v1/supplier-portal/pcns/profiles').set('Cookie', users[1]!.cookie).expect(200).expect(({ body }) => expect(body.items).toEqual([expect.objectContaining({ id: profileId, displayName: '供应商甲' })]));
  });
  it('rejects invalid dates and whitespace inputs', async () => {
    await post(1, 'supplier-portal/pcns', { profileId, ...facts, plannedDate: '2026-02-30' }).expect(400);
    await post(1, 'supplier-portal/pcns', { profileId, ...facts, riskControl: '   ' }).expect(400);
  });
  it('requires scanned resource evidence, replays once, and records revised submission snapshots', async () => {
    const pcn = await create();
    const pending = await file(pcn.id, false);
    await post(1, `supplier-portal/pcns/${pcn.id}/submit`, { expectedVersion: 1, fileId: pending.id }).expect(409);
    const other = await create();
    const otherFile = await file(other.id);
    await post(1, `supplier-portal/pcns/${pcn.id}/submit`, { expectedVersion: 1, fileId: otherFile.id }).expect(403);
    const evidence = await file(pcn.id);
    const key = randomUUID();
    const input = { expectedVersion: 1, fileId: evidence.id };
    await post(1, `supplier-portal/pcns/${pcn.id}/submit`, input, key).expect(201);
    await post(1, `supplier-portal/pcns/${pcn.id}/submit`, input, key).expect(201);
    await post(1, `supplier-portal/pcns/${pcn.id}/submit`, { ...input, fileId: pending.id }, key).expect(409);
    await post(0, `supplier-pcn/requests/${pcn.id}/start`, { expectedVersion: 2, workflowDefinitionId, workflowVersionId }).expect(201);
    let detail = await request(app.getHttpServer()).get(`/api/v1/supplier-portal/pcns/${pcn.id}`).set('Cookie', users[1]!.cookie).expect(200);
    await post(1, `supplier-portal/pcns/${pcn.id}/advance`, { expectedVersion: 3, fileId: evidence.id, expectedWorkflowVersion: detail.body.workflow.version, expectedProblemVersion: detail.body.workflow.problemVersion, currentNodeId: detail.body.workflow.currentNodeId }).expect(201);
    detail = await request(app.getHttpServer()).get(`/api/v1/supplier-pcn/requests/${pcn.id}`).set('Cookie', users[0]!.cookie).expect(200);
    await post(0, `supplier-pcn/requests/${pcn.id}/review`, { expectedVersion: 3, action: 'RETURN', note: '请补充风险评估', expectedWorkflowVersion: detail.body.workflow.version, expectedProblemVersion: detail.body.workflow.problemVersion, currentNodeId: detail.body.workflow.currentNodeId }).expect(201);
    await post(1, `supplier-portal/pcns/${pcn.id}/update`, { ...facts, expectedVersion: 4, riskControl: '加严检验' }).expect(201);
    await post(1, `supplier-portal/pcns/${pcn.id}/submit`, { expectedVersion: 5, fileId: evidence.id }).expect(201);
    detail = await request(app.getHttpServer()).get(`/api/v1/supplier-portal/pcns/${pcn.id}`).set('Cookie', users[1]!.cookie).expect(200);
    await post(1, `supplier-portal/pcns/${pcn.id}/advance`, { expectedVersion: 6, fileId: evidence.id, expectedWorkflowVersion: detail.body.workflow.version, expectedProblemVersion: detail.body.workflow.problemVersion, currentNodeId: detail.body.workflow.currentNodeId }).expect(201);
    detail = await request(app.getHttpServer()).get(`/api/v1/supplier-pcn/requests/${pcn.id}`).set('Cookie', users[0]!.cookie).expect(200);
    await post(0, `supplier-pcn/requests/${pcn.id}/review`, { expectedVersion: 6, action: 'APPROVE', note: '验证方案满足要求', expectedWorkflowVersion: detail.body.workflow.version, expectedProblemVersion: detail.body.workflow.problemVersion, currentNodeId: detail.body.workflow.currentNodeId }).expect(201);
    await post(1, `supplier-portal/pcns/${pcn.id}/update`, { ...facts, expectedVersion: 7 }).expect(409);
    detail = await request(app.getHttpServer()).get(`/api/v1/supplier-portal/pcns/${pcn.id}`).set('Cookie', users[1]!.cookie).expect(200);
    expect(detail.body.events.map((event: { eventType: string }) => event.eventType)).toEqual(['CREATED', 'SUBMITTED', 'STARTED', 'NEEDS_CHANGES', 'UPDATED', 'SUBMITTED', 'APPROVED']);
    expect(detail.body.events[1].snapshot.riskControl).toBe(facts.riskControl);
    expect(detail.body.events[5].snapshot.riskControl).toBe('加严检验');
    expect(await prisma.auditEvent.count({ where: { resourceId: pcn.id, action: { startsWith: 'SUPPLIER_PCN_' } } })).toBe(7);
  });
  it('allows only one concurrent review and preserves the losing state', async () => {
    const pcn = await advanced();
    const detail = await request(app.getHttpServer()).get(`/api/v1/supplier-pcn/requests/${pcn.id}`).set('Cookie', users[0]!.cookie).expect(200);
    const results = await Promise.all(['APPROVE', 'RETURN'].map(action => post(0, `supplier-pcn/requests/${pcn.id}/review`, { expectedVersion: 3, action, note: '审核意见', expectedWorkflowVersion: detail.body.workflow.version, expectedProblemVersion: detail.body.workflow.problemVersion, currentNodeId: detail.body.workflow.currentNodeId })));
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    const events = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM supplier_pcn_events WHERE pcn_id = ${pcn.id}::uuid`;
    expect(Number(events[0]!.count)).toBe(4);
  });
  it('rejects approval when submitted evidence becomes unavailable', async () => {
    const pcn = await advanced();
    await prisma.fileObject.update({ where: { id: pcn.fileId }, data: { status: 'QUARANTINED', scanStatus: 'REJECTED', scanReason: 'FILE_SCAN_POLICY_REJECTED' } });
    const detail = await request(app.getHttpServer()).get(`/api/v1/supplier-pcn/requests/${pcn.id}`).set('Cookie', users[0]!.cookie).expect(200);
    await post(0, `supplier-pcn/requests/${pcn.id}/review`, { expectedVersion: 3, action: 'APPROVE', note: '同意', expectedWorkflowVersion: detail.body.workflow.version,
      expectedProblemVersion: detail.body.workflow.problemVersion, currentNodeId: detail.body.workflow.currentNodeId }).expect(409);
    const current = await request(app.getHttpServer()).get(`/api/v1/supplier-pcn/requests/${pcn.id}`).set('Cookie', users[0]!.cookie).expect(200);
    expect(current.body.status).toBe('SUBMITTED');
    expect(current.body.events).toHaveLength(3);
  });
  it('rechecks permission before returning an idempotent response', async () => {
    const key = randomUUID();
    const input = { profileId, ...facts };
    await post(1, 'supplier-portal/pcns', input, key).expect(201);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'supplier-pcn:submissions:write' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: users[1]!.roleId, permissionId: permission.id } } });
    try { await post(1, 'supplier-portal/pcns', input, key).expect(403); }
    finally { await prisma.rolePermission.create({ data: { roleId: users[1]!.roleId, permissionId: permission.id } }); }
  });
});
