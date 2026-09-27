import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AuditManagementService } from '../../src/modules/audit-management/audit-management.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') {
  throw new Error('An independent disposable PostgreSQL database is required');
}

describe('audit management PostgreSQL invariants', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const service = new AuditManagementService(prisma, mutations, audit);
  const organizationId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const roleId = randomUUID();
  const reviewerId = randomUUID();
  const reviewerSessionId = randomUUID();
  const actor = { id: userId, organizationId, accountType: 'INTERNAL' as const, sessionId };
  const reviewer = { id: reviewerId, organizationId, accountType: 'INTERNAL' as const, sessionId: reviewerSessionId };

  beforeAll(async () => {
    await prisma.$connect();
    const [server] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(server!.server_version_num)).toBeGreaterThanOrEqual(180000);
    await prisma.organization.create({ data: { id: organizationId, code: `AUD-${organizationId.slice(0, 8)}`, name: 'Audit Org', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: userId, organizationId, username: `aud-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.user.create({ data: { id: reviewerId, organizationId, username: `aud-${reviewerId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.session.create({ data: { id: reviewerSessionId, userId: reviewerId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'AUDITOR', name: 'Auditor' } });
    for (const code of ['audit-management:read', 'audit-management:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId } });
    await prisma.userRole.create({ data: { userId: reviewerId, organizationId, roleId } });
    await service.registerDeadlinePolicy(actor, { policyVersion: 'AUDIT-SLA-2026.1', calendarVersion: 'CN-WORKDAY-2026.1', timeZone: 'Asia/Shanghai', workingWeekdays: [1, 2, 3, 4, 5], exceptions: {}, severityDays: { MINOR: 30, MAJOR: 30, CRITICAL: 7 } }, randomUUID(), randomUUID());
  });

  afterAll(async () => prisma.$disconnect());

  it('refuses an NC deadline without a registered immutable calendar policy', async () => {
    const template = await service.createTemplate(actor, { name: '期限政策', auditType: 'PRODUCT', definition: { items: [{ key: 'P1', text: '符合' }] } }, randomUUID(), randomUUID());
    const published = await service.publishTemplate(actor, template.id, 1, randomUUID(), randomUUID());
    const plan = await service.createPlan(actor, { year: 2026, title: '期限政策计划', auditType: 'PRODUCT', plannedStart: '2026-10-01T00:00:00.000Z', plannedEnd: '2026-10-31T00:00:00.000Z' }, randomUUID(), randomUUID());
    const execution = await service.createExecution(actor, plan.id, published.versionId, randomUUID(), randomUUID());
    const result = await service.recordChecklistResult(actor, execution.id, { itemKey: 'P1', result: 'NG' }, randomUUID(), randomUUID());
    await expect(service.createNcFromNg(actor, execution.id, result.id, { severity: 'MAJOR', dueAt: '2026-12-01T00:00:00.000Z', duePolicyVersion: 'UNKNOWN', calendarVersion: 'UNKNOWN', dueBusinessDays: 30 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('keeps a published template version immutable and fixes execution to it', async () => {
    const template = await service.createTemplate(actor, { name: 'IATF过程审核', auditType: 'PROCESS', definition: { items: [{ key: 'P1', text: '过程受控' }] } }, randomUUID(), randomUUID());
    const published = await service.publishTemplate(actor, template.id, 1, randomUUID(), randomUUID());
    await expect(service.updateTemplate(actor, template.id, { expectedVersion: 2, definition: { items: [] } }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const plan = await service.createPlan(actor, { year: 2026, title: '年度审核计划', auditType: 'PROCESS', plannedStart: '2026-10-01T00:00:00.000Z', plannedEnd: '2026-10-31T00:00:00.000Z' }, randomUUID(), randomUUID());
    const execution = await service.createExecution(actor, plan.id, published.versionId, randomUUID(), randomUUID());
    expect(execution.template_version_id).toBe(published.versionId);
  });

  it('creates NC atomically from NG and enforces verify-before-close', async () => {
    const template = await service.createTemplate(actor, { name: '产品审核', auditType: 'PRODUCT', definition: { items: [{ key: 'P1', text: '产品符合' }] } }, randomUUID(), randomUUID());
    const published = await service.publishTemplate(actor, template.id, 1, randomUUID(), randomUUID());
    const plan = await service.createPlan(actor, { year: 2026, title: '产品计划', auditType: 'PRODUCT', plannedStart: '2026-11-01T00:00:00.000Z', plannedEnd: '2026-11-30T00:00:00.000Z' }, randomUUID(), randomUUID());
    const execution = await service.createExecution(actor, plan.id, published.versionId, randomUUID(), randomUUID());
    const result = await service.recordChecklistResult(actor, execution.id, { itemKey: 'P1', result: 'NG', note: '缺少记录' }, randomUUID(), randomUUID());
    const nc = await service.createNcFromNg(actor, execution.id, result.id, { severity: 'MAJOR', duePolicyVersion: 'AUDIT-SLA-2026.1', calendarVersion: 'CN-WORKDAY-2026.1', dueBusinessDays: 30 }, randomUUID(), randomUUID());
    expect(typeof nc.due_at).toBe('string');
    expect(await service.listNcsForExecution(actor, execution.id)).toEqual([expect.objectContaining({ id: nc.id, checklist_result_id: result.id, status: 'OPEN' })]);
    await expect(service.recordChecklistResult(actor, execution.id, { itemKey: 'P1', result: 'OK' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.closeNc(actor, nc.id, 1, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await service.assignNc(actor, nc.id, userId, 1, randomUUID(), randomUUID());
    await service.respondNc(actor, nc.id, { expectedVersion: 2, response: '已补充记录' }, randomUUID(), randomUUID());
    await expect(service.verifyNc(actor, nc.id, 3, true, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await service.verifyNc(reviewer, nc.id, 3, true, randomUUID(), randomUUID(), '复测记录符合要求');
    const closed = await service.closeNc(reviewer, nc.id, 4, randomUUID(), randomUUID());
    expect(closed.status).toBe('CLOSED');
    expect(await service.listNcsForExecution(actor, execution.id)).toEqual([expect.objectContaining({ status: 'CLOSED', verification_note: '复测记录符合要求', closed_by_id: reviewerId })]);
  });

  it('accepts checklist keys only from the fixed published template', async () => {
    const template = await service.createTemplate(actor, { name: '固定条款', auditType: 'PROCESS', definition: { items: [{ key: 'P1', text: '过程受控' }] } }, randomUUID(), randomUUID());
    const published = await service.publishTemplate(actor, template.id, 1, randomUUID(), randomUUID());
    const plan = await service.createPlan(actor, { year: 2026, title: '固定条款计划', auditType: 'PROCESS', plannedStart: '2026-10-01T00:00:00.000Z', plannedEnd: '2026-10-31T00:00:00.000Z' }, randomUUID(), randomUUID());
    const execution = await service.createExecution(actor, plan.id, published.versionId, randomUUID(), randomUUID());
    await expect(service.recordChecklistResult(actor, execution.id, { itemKey: 'UNKNOWN', result: 'NG' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    const result = await service.recordChecklistResult(actor, execution.id, { itemKey: 'P1', result: 'NG' }, randomUUID(), randomUUID());
    expect(result.item_key).toBe('P1');
  });

  it('rejects malformed template items before publication', async () => {
    expect(() => service.createTemplate(actor, { name: '重复条款', auditType: 'PROCESS', definition: { items: [{ key: 'P1', text: '一' }, { key: 'P1', text: '二' }] } }, randomUUID(), randomUUID())).toThrow();
    expect(() => service.createTemplate(actor, { name: '空条款', auditType: 'PROCESS', definition: { items: [] } }, randomUUID(), randomUUID())).toThrow();
  });

  it('requires an auditable policy and business-calendar basis for NC deadlines', async () => {
    await expect(service.createNcFromNg(actor, randomUUID(), randomUUID(), {
      severity: 'MAJOR', dueAt: '2026-12-01T00:00:00.000Z', duePolicyVersion: '', calendarVersion: '', dueBusinessDays: 0,
    }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
  });

  it('does not create an NC from a cancelled execution', async () => {
    const template = await service.createTemplate(actor, { name: '取消执行', auditType: 'PRODUCT', definition: { items: [{ key: 'P1', text: '产品符合' }] } }, randomUUID(), randomUUID());
    const published = await service.publishTemplate(actor, template.id, 1, randomUUID(), randomUUID());
    const plan = await service.createPlan(actor, { year: 2026, title: '取消计划', auditType: 'PRODUCT', plannedStart: '2026-11-01T00:00:00.000Z', plannedEnd: '2026-11-30T00:00:00.000Z' }, randomUUID(), randomUUID());
    const execution = await service.createExecution(actor, plan.id, published.versionId, randomUUID(), randomUUID());
    const result = await service.recordChecklistResult(actor, execution.id, { itemKey: 'P1', result: 'NG' }, randomUUID(), randomUUID());
    await prisma.$executeRaw`UPDATE audit_executions SET status = 'CANCELLED' WHERE id = ${execution.id}::uuid`;
    await expect(service.createNcFromNg(actor, execution.id, result.id, { severity: 'MAJOR', duePolicyVersion: 'AUDIT-SLA-2026.1', calendarVersion: 'CN-WORKDAY-2026.1', dueBusinessDays: 30 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await prisma.$executeRaw`UPDATE audit_executions SET status = 'COMPLETED' WHERE id = ${execution.id}::uuid`;
    await expect(service.createNcFromNg(actor, execution.id, result.id, { severity: 'MAJOR', duePolicyVersion: 'AUDIT-SLA-2026.1', calendarVersion: 'CN-WORKDAY-2026.1', dueBusinessDays: 30 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('rejects an assignee from another organization', async () => {
    const otherOrganizationId = randomUUID();
    const otherUserId = randomUUID();
    await prisma.organization.create({ data: { id: otherOrganizationId, code: `AUD-${otherOrganizationId.slice(0, 8)}`, name: 'Other Audit Org', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: otherUserId, organizationId: otherOrganizationId, username: `aud-${otherUserId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const template = await service.createTemplate(actor, { name: '指派范围', auditType: 'PRODUCT', definition: { items: [{ key: 'P1', text: '产品符合' }] } }, randomUUID(), randomUUID());
    const published = await service.publishTemplate(actor, template.id, 1, randomUUID(), randomUUID());
    const plan = await service.createPlan(actor, { year: 2026, title: '指派范围计划', auditType: 'PRODUCT', plannedStart: '2026-11-01T00:00:00.000Z', plannedEnd: '2026-11-30T00:00:00.000Z' }, randomUUID(), randomUUID());
    const execution = await service.createExecution(actor, plan.id, published.versionId, randomUUID(), randomUUID());
    const result = await service.recordChecklistResult(actor, execution.id, { itemKey: 'P1', result: 'NG' }, randomUUID(), randomUUID());
    const nc = await service.createNcFromNg(actor, execution.id, result.id, { severity: 'MINOR', duePolicyVersion: 'AUDIT-SLA-2026.1', calendarVersion: 'CN-WORKDAY-2026.1', dueBusinessDays: 30 }, randomUUID(), randomUUID());
    await expect(service.assignNc(actor, nc.id, otherUserId, 1, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
  });

  it('rejects import adapter values outside the recorded source contract', async () => {
    expect(() => service.importCustomerOrSecondPartyRow(actor, { sourceSystem: 'UNKNOWN' as 'CUSTOMER', map: () => ({ externalKey: 'X1', payload: {} }) }, {}, randomUUID(), randomUUID())).toThrow();
  });

  it('records customer and second-party imports idempotently within the organization', async () => {
    const externalKey = `CUST-${randomUUID()}`;
    const adapter = { sourceSystem: 'CUSTOMER' as const, map: (record: unknown) => ({ externalKey, payload: record as Record<string, unknown> }) };
    const imported = await service.importCustomerOrSecondPartyRow(actor, adapter, { plan: '2026-Q4', findingCount: 2 }, randomUUID(), randomUUID());
    expect(imported).toMatchObject({ organization_id: organizationId, source_system: 'CUSTOMER', external_key: externalKey, status: 'PENDING_REVIEW', payload: { plan: '2026-Q4', findingCount: 2 } });
    await expect(service.importCustomerOrSecondPartyRow(actor, adapter, { plan: '2026-Q4' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409, response: { code: 'AUDIT_IMPORT_DUPLICATE' } });
  });

  it('rolls back a rejected postponement and honors plan CAS', async () => {
    const plan = await service.createPlan(actor, { year: 2027, title: '审核计划', auditType: 'SYSTEM', plannedStart: '2027-01-01T00:00:00.000Z', plannedEnd: '2027-01-31T00:00:00.000Z' }, randomUUID(), randomUUID());
    const updated = await service.updatePlan(actor, plan.id, { expectedVersion: 1, title: '新计划' }, randomUUID(), randomUUID());
    expect(updated.version).toBe(2);
    await expect(service.updatePlan(actor, plan.id, { expectedVersion: 1, title: '过期' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const request = await service.requestPostponement(actor, plan.id, { expectedVersion: 2, proposedStart: '2027-02-01T00:00:00.000Z', proposedEnd: '2027-02-28T00:00:00.000Z', reason: '资源冲突' }, randomUUID(), randomUUID());
    await service.approvePostponement(actor, request.id, false, 1, randomUUID(), randomUUID());
    const current = await service.getPlan(actor, plan.id);
    expect(current.planned_start.toISOString()).toContain('2027-01-01');
  });

  it('rejects stale mobile edits and replays the same command without another write', async () => {
    const template = await service.createTemplate(actor, { name: '草稿并发', auditType: 'PROCESS', definition: { items: [{ key: 'P1', text: '过程受控' }] } }, randomUUID(), randomUUID());
    const published = await service.publishTemplate(actor, template.id, 1, randomUUID(), randomUUID());
    const plan = await service.createPlan(actor, { year: 2027, title: '草稿并发', auditType: 'PROCESS', plannedStart: '2027-01-01T00:00:00Z', plannedEnd: '2027-01-31T00:00:00Z' }, randomUUID(), randomUUID());
    const execution = await service.createExecution(actor, plan.id, published.versionId, randomUUID(), randomUUID());
    const input = { itemKey: 'P1', result: 'NG' as const, note: '原始记录', expectedVersion: 0 };
    const key = randomUUID();
    const recorded = await service.recordChecklistResult(actor, execution.id, input, randomUUID(), key);
    expect(await service.recordChecklistResult(actor, execution.id, input, randomUUID(), key)).toEqual(recorded);
    await expect(service.recordChecklistResult(actor, execution.id, { ...input, result: 'OK' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect((await service.getExecution(actor, execution.id)).checklist[0]).toMatchObject({ note: '原始记录', version: 1 });
    const other = await service.createExecution(actor, plan.id, published.versionId, randomUUID(), randomUUID());
    await expect(service.recordChecklistResult(actor, other.id, input, randomUUID(), key)).rejects.toMatchObject({ status: 409 });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'audit-management:write' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: permission.id } } });
    try {
      await expect(service.recordChecklistResult(actor, execution.id, input, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
      await expect(service.submitExecution(actor, execution.id, 1, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    } finally { await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } }); }
  });

  it('returns a resumable execution snapshot and submits with a version guard', async () => {
    const template = await service.createTemplate(actor, { name: '移动审核', auditType: 'PROCESS', definition: { items: [{ key: 'P1', text: '过程受控' }, { key: 'P2', text: '记录完整' }] } }, randomUUID(), randomUUID());
    const published = await service.publishTemplate(actor, template.id, 1, randomUUID(), randomUUID());
    const plan = await service.createPlan(actor, { year: 2027, title: '移动执行', auditType: 'PROCESS', plannedStart: '2027-01-01T00:00:00.000Z', plannedEnd: '2027-01-31T00:00:00.000Z' }, randomUUID(), randomUUID());
    const execution = await service.createExecution(actor, plan.id, published.versionId, randomUUID(), randomUUID());
    await service.recordChecklistResult(actor, execution.id, { itemKey: 'P1', result: 'OK' }, randomUUID(), randomUUID());
    const snapshot = await service.getExecution(actor, execution.id);
    expect(snapshot.execution).toMatchObject({ id: execution.id, status: 'OPEN', version: 1 });
    expect(snapshot.items).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'P1', text: '过程受控' }), expect.objectContaining({ key: 'P2', text: '记录完整' })]));
    expect(snapshot.checklist).toEqual(expect.arrayContaining([expect.objectContaining({ item_key: 'P1', result: 'OK' })]));
    await expect(service.submitExecution(actor, execution.id, 1, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await service.recordChecklistResult(actor, execution.id, { itemKey: 'P2', result: 'NA' }, randomUUID(), randomUUID());
    const submitted = await service.submitExecution(actor, execution.id, 1, randomUUID(), randomUUID());
    expect(submitted).toMatchObject({ status: 'SUBMITTED', version: 2 });
    await expect(service.submitExecution(actor, execution.id, 1, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });
});
