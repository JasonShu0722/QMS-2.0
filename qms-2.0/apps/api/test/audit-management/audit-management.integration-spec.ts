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
  const reviewerId = `f${randomUUID().slice(1)}`;
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

  it('lets two auditors assign separate findings to each other concurrently', async () => {
    const template = await service.createTemplate(actor, { name: '交叉分派', auditType: 'PRODUCT', definition: { items: [{ key: 'P1', text: '第一项' }, { key: 'P2', text: '第二项' }] } }, randomUUID(), randomUUID());
    const published = await service.publishTemplate(actor, template.id, 1, randomUUID(), randomUUID());
    const plan = await service.createPlan(actor, { year: 2026, title: '交叉分派', auditType: 'PRODUCT', plannedStart: '2026-10-01T00:00:00.000Z', plannedEnd: '2026-10-31T00:00:00.000Z' }, randomUUID(), randomUUID());
    const execution = await service.createExecution(actor, plan.id, published.versionId, randomUUID(), randomUUID());
    const findings = [];
    for (const itemKey of ['P1', 'P2']) {
      const result = await service.recordChecklistResult(actor, execution.id, { itemKey, result: 'NG' }, randomUUID(), randomUUID());
      findings.push(await service.createNcFromNg(actor, execution.id, result.id, { severity: 'MAJOR', duePolicyVersion: 'AUDIT-SLA-2026.1', calendarVersion: 'CN-WORKDAY-2026.1', dueBusinessDays: 30 }, randomUUID(), randomUUID()));
    }
    const [first, second] = findings;
    const firstKey = randomUUID();
    const assigned = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM audit_ncs WHERE id IN (${first!.id}::uuid, ${second!.id}::uuid) FOR UPDATE`;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      const requests = Promise.allSettled([
        service.assignNc(actor, first!.id, reviewer.id, 1, randomUUID(), firstKey),
        service.assignNc(reviewer, second!.id, actor.id, 1, randomUUID(), randomUUID()),
      ]);
      for (let attempt = 0; attempt < 100; attempt++) {
        const waiters = await prisma.$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE ${backend!.pid} = ANY(pg_blocking_pids(pid)) AND query LIKE '%FROM audit_ncs%'`;
        if (waiters.length === 2) return { requests, queued: true };
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return { requests, queued: false };
    });
    const results = await assigned.requests;
    expect(assigned.queued).toBe(true);
    expect(results).toMatchObject([
      { status: 'fulfilled', value: { assignee_user_id: reviewer.id, version: 2 } },
      { status: 'fulfilled', value: { assignee_user_id: actor.id, version: 2 } },
    ]);
    const replay = await service.assignNc(actor, first!.id, reviewer.id, 1, randomUUID(), firstKey);
    expect(results[0]).toEqual({ status: 'fulfilled', value: replay });
    expect(await prisma.auditEvent.count({ where: { resourceId: first!.id, action: 'AUDIT_NC_ASSIGNED' } })).toBe(1);
  }, 15_000);

  it('lets reassignment win over a concurrent response on the same rejected finding', async () => {
    const template = await service.createTemplate(actor, { name: '退回复核', auditType: 'PRODUCT', definition: { items: [{ key: 'P1', text: '符合' }] } }, randomUUID(), randomUUID());
    const published = await service.publishTemplate(actor, template.id, 1, randomUUID(), randomUUID());
    const plan = await service.createPlan(actor, { year: 2026, title: '退回复核', auditType: 'PRODUCT', plannedStart: '2026-10-01T00:00:00.000Z', plannedEnd: '2026-10-31T00:00:00.000Z' }, randomUUID(), randomUUID());
    const execution = await service.createExecution(actor, plan.id, published.versionId, randomUUID(), randomUUID());
    const result = await service.recordChecklistResult(actor, execution.id, { itemKey: 'P1', result: 'NG' }, randomUUID(), randomUUID());
    const nc = await service.createNcFromNg(actor, execution.id, result.id, { severity: 'MAJOR', duePolicyVersion: 'AUDIT-SLA-2026.1', calendarVersion: 'CN-WORKDAY-2026.1', dueBusinessDays: 30 }, randomUUID(), randomUUID());
    await service.assignNc(actor, nc.id, reviewer.id, 1, randomUUID(), randomUUID());
    await service.respondNc(reviewer, nc.id, { expectedVersion: 2, response: '初次整改' }, randomUUID(), randomUUID());
    await service.verifyNc(actor, nc.id, 3, false, randomUUID(), randomUUID());
    const target = await prisma.user.create({ data: { id: `0${randomUUID().slice(1)}`, organizationId, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'fixture' } });

    async function waitForWaiter(blocker: number, queryFragment: string) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const [waiter] = await prisma.$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid)) AND query LIKE ${`%${queryFragment}%`}`;
        if (waiter) return waiter.pid;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return undefined;
    }

    const race = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${target.id}::uuid FOR UPDATE`;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      const assignment = service.assignNc(actor, nc.id, target.id, 4, randomUUID(), randomUUID()).catch((error: unknown) => error);
      const assigningPid = await waitForWaiter(backend!.pid, 'FROM users');
      const response = service.respondNc(reviewer, nc.id, { expectedVersion: 4, response: '再次整改' }, randomUUID(), randomUUID()).catch((error: unknown) => error);
      const respondingPid = assigningPid && await waitForWaiter(assigningPid, 'FROM audit_ncs');
      const [identityProbe] = await Promise.allSettled([
        prisma.$queryRaw`SELECT id FROM users WHERE id = ${reviewer.id}::uuid FOR SHARE NOWAIT`,
      ]);
      return { assignment, response, assigningPid, respondingPid, identityProbe };
    });
    const [assignment, response] = await Promise.all([race.assignment, race.response]);
    expect(race.assigningPid).toEqual(expect.any(Number));
    expect(race.respondingPid).toEqual(expect.any(Number));
    expect(race.identityProbe?.status).toBe('fulfilled');
    expect(assignment).toMatchObject({ assignee_user_id: target.id, status: 'ASSIGNED', version: 5 });
    expect(response).toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(await service.listNcsForExecution(actor, execution.id)).toMatchObject([{ assignee_user_id: target.id, status: 'ASSIGNED', version: 5 }]);
  }, 15_000);

  it('lets an auditor recover an assigned finding after its owner is permanently deleted', async () => {
    const template = await service.createTemplate(actor, { name: '责任人补配', auditType: 'PRODUCT', definition: { items: [{ key: 'P1', text: '符合' }] } }, randomUUID(), randomUUID());
    const published = await service.publishTemplate(actor, template.id, 1, randomUUID(), randomUUID());
    const plan = await service.createPlan(actor, { year: 2026, title: '责任人补配', auditType: 'PRODUCT', plannedStart: '2026-10-01T00:00:00.000Z', plannedEnd: '2026-10-31T00:00:00.000Z' }, randomUUID(), randomUUID());
    const execution = await service.createExecution(actor, plan.id, published.versionId, randomUUID(), randomUUID());
    const result = await service.recordChecklistResult(actor, execution.id, { itemKey: 'P1', result: 'NG' }, randomUUID(), randomUUID());
    const nc = await service.createNcFromNg(actor, execution.id, result.id, { severity: 'MAJOR', duePolicyVersion: 'AUDIT-SLA-2026.1', calendarVersion: 'CN-WORKDAY-2026.1', dueBusinessDays: 30 }, randomUUID(), randomUUID());
    const previous = await prisma.user.create({ data: { organizationId, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'fixture' } });
    await service.assignNc(actor, nc.id, previous.id, 1, randomUUID(), randomUUID());
    await prisma.user.update({ where: { id: previous.id }, data: { status: 'DISABLED' } });
    await expect(service.assignNc(actor, nc.id, reviewerId, 2, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await prisma.user.update({ where: { id: previous.id }, data: { deletedAt: new Date() } });
    expect(await service.listNcsForExecution(actor, execution.id)).toMatchObject([{ status: 'ASSIGNED', assignee_user_id: previous.id, assignee_deleted: true }]);
    await expect(service.assignNc(actor, nc.id, previous.id, 2, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const retiring = await prisma.user.create({ data: { organizationId, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'fixture' } });
    let signalLocked!: (pid: number) => void;
    let signalRelease!: () => void;
    const locked = new Promise<number>(resolve => { signalLocked = resolve; });
    const release = new Promise<void>(resolve => { signalRelease = resolve; });
    const deletion = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${retiring.id}::uuid FOR UPDATE`;
      await tx.user.update({ where: { id: retiring.id }, data: { status: 'DISABLED', deletedAt: new Date() } });
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      signalLocked(backend!.pid);
      await release;
    });
    const pid = await locked;
    const assigning = service.assignNc(actor, nc.id, retiring.id, 2, randomUUID(), randomUUID()).catch((error: unknown) => error);
    let waiting = false;
    try {
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [waiter] = await prisma.$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND query LIKE '%FOR SHARE%'`;
        waiting = !!waiter;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
    } finally {
      signalRelease();
      await deletion;
      await assigning;
    }
    expect(waiting).toBe(true);
    expect(await assigning).toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(await service.listNcsForExecution(actor, execution.id)).toMatchObject([{ version: 2, assignee_user_id: previous.id }]);
    const key = randomUUID();
    const assigned = await service.assignNc(actor, nc.id, reviewerId, 2, randomUUID(), key);
    expect(assigned).toMatchObject({ status: 'ASSIGNED', assignee_user_id: reviewerId, version: 3, due_at: nc.due_at });
    expect(await service.assignNc(actor, nc.id, reviewerId, 2, randomUUID(), key)).toEqual(assigned);
    expect(await prisma.auditEvent.findMany({ where: { resourceId: nc.id, action: 'AUDIT_NC_ASSIGNED' }, orderBy: { createdAt: 'asc' } }))
      .toMatchObject([{}, { metadata: { targetUserId: previous.id, reasonCode: 'AUDIT_NC_HISTORICAL_ASSIGNEE_DELETED', resourceVersion: 3 } }]);
    await service.respondNc(reviewer, nc.id, { expectedVersion: 3, response: '补配后已完成整改' }, randomUUID(), randomUUID());
    await service.verifyNc(actor, nc.id, 4, true, randomUUID(), randomUUID());
    expect(await service.closeNc(actor, nc.id, 5, randomUUID(), randomUUID())).toMatchObject({ status: 'CLOSED', version: 6 });
  }, 30_000);

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
