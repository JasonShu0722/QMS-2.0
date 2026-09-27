import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { QualityDataService } from '../../src/modules/quality-data/quality-data.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') {
  throw new Error('An independent disposable PostgreSQL database is required');
}

describe('quality data foundation on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const problems = new ProblemIndexService(prisma, new NumberingService(prisma), audit, new OutboxService(prisma));
  const service = new QualityDataService(prisma, mutations, problems);
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const sessionId = randomUUID();
  const roleId = randomUUID();
  const drilldownProblemIds: string[] = [];
  const drilldownDefectIds: string[] = [];
  const drilldownDefectTypeIds: string[] = [];
  const actor = { id: userId, organizationId, sessionId, accountType: 'INTERNAL' as const };
  const periodStart = new Date('2026-09-01T00:00:00.000Z');
  const periodEnd = new Date('2026-10-01T00:00:00.000Z');

  beforeAll(async () => {
    await prisma.$connect();
    const [server] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(server!.server_version_num)).toBeGreaterThanOrEqual(180000);
    for (const [id, suffix] of [[organizationId, 'owner'], [otherOrganizationId, 'other']]) {
      await prisma.organization.create({ data: { id, code: `QD-${suffix}-${id.slice(0, 8)}`, name: suffix, type: 'INTERNAL' } });
    }
    await prisma.user.create({ data: { id: userId, organizationId, username: `qd-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.user.create({ data: { id: otherUserId, organizationId: otherOrganizationId, username: `qd-${otherUserId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'QUALITY_DATA', name: 'Quality data' } });
    for (const code of ['quality-data:metrics:read', 'quality-data:metrics:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId } });
  }, 30_000);

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM quality_metric_facts WHERE organization_id IN (${organizationId}::uuid, ${otherOrganizationId}::uuid)`;
    await prisma.$executeRaw`DELETE FROM quality_data_snapshots WHERE organization_id IN (${organizationId}::uuid, ${otherOrganizationId}::uuid)`;
    await prisma.problemIndex.deleteMany({ where: { id: { in: drilldownProblemIds } } });
    await prisma.processDefect.deleteMany({ where: { id: { in: drilldownDefectIds } } });
    await prisma.processDefectType.deleteMany({ where: { id: { in: drilldownDefectTypeIds } } });
    await prisma.$executeRaw`DELETE FROM quality_metric_definitions WHERE organization_id = ${organizationId}::uuid`;
    await prisma.adminMutation.deleteMany({ where: { organizationId } });
    await prisma.auditEvent.deleteMany({ where: { organizationId } });
    await prisma.userRole.deleteMany({ where: { roleId } });
    await prisma.role.delete({ where: { id: roleId } });
    await prisma.session.delete({ where: { id: sessionId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
    await prisma.$disconnect();
  }, 30_000);

  async function definition(code = `PASS-${randomUUID().slice(0, 8)}`) {
    return service.createDefinition(actor, { code, name: '直通率', unit: '%', numeratorLabel: '合格数', denominatorLabel: '投入数', formulaVersion: 'v1' }, randomUUID(), randomUUID());
  }

  it('calculates PPM and applies configured threshold signals over abnormal periods', async () => {
    const metric = await service.createDefinition(actor, { code: `PPM-${randomUUID().slice(0, 8)}`, name: '制程 PPM', unit: 'PPM', numeratorLabel: '不良数', denominatorLabel: '生产数', formulaVersion: 'standard-v1', formulaCode: 'PPM', thresholdDirection: 'LTE', greenThreshold: 100, yellowThreshold: 200, abnormalPeriodLimit: 2 }, randomUUID(), randomUUID());
    const periods = [
      [new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'), 1],
      [new Date('2026-02-01T00:00:00Z'), new Date('2026-03-01T00:00:00Z'), 3],
      [new Date('2026-03-01T00:00:00Z'), new Date('2026-04-01T00:00:00Z'), 4],
    ] as const;
    for (const [start, end, numerator] of periods) await service.recordFact(actor, { metricDefinitionId: metric.id as string, periodStart: start, periodEnd: end, numerator, denominator: 10000, sourceSystem: 'MANUAL', sourceRecordKey: randomUUID() }, randomUUID(), randomUUID());
    const dashboard = await service.dashboard(actor, { metricDefinitionId: metric.id as string, limit: 10 });
    expect(dashboard.cards).toEqual([expect.objectContaining({ latestValue: 400, signal: 'RED', abnormalPeriods: 2, consecutiveRedPeriods: 2, alert: true })]);
  });

  it('persists metric definitions and replays the same idempotency key', async () => {
    const key = randomUUID();
    const input = { code: `RATE-${randomUUID().slice(0, 8)}`, name: '直通率', unit: '%', numeratorLabel: '合格数', denominatorLabel: '投入数', formulaVersion: 'v1' };
    const created = await service.createDefinition(actor, input, randomUUID(), key);
    expect(await service.createDefinition(actor, input, randomUUID(), key)).toEqual(created);
    expect(await service.listDefinitions(actor, organizationId)).toContainEqual(created);
    expect(await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM quality_metric_definitions WHERE id = ${created.id}::uuid`).toHaveLength(1);
    await expect(service.createDefinition(actor, { ...input, name: '改名' }, randomUUID(), key)).rejects.toMatchObject({ status: 409 });
    await expect(service.createDefinition(actor, input, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('persists facts, blocks duplicate sources, and rejects inconsistent periods', async () => {
    const metric = await definition();
    const input = { metricDefinitionId: metric.id as string, periodStart, periodEnd, numerator: 90, denominator: 100, sourceSystem: 'MANUAL' as const, sourceRecordKey: randomUUID() };
    const key = randomUUID();
    const recorded = await service.recordFact(actor, input, randomUUID(), key);
    expect(recorded).toMatchObject({ numerator: 90, denominator: 100, value: 0.9, sourceSystem: 'MANUAL', sourceRecordKey: input.sourceRecordKey });
    expect(await service.recordFact(actor, input, randomUUID(), key)).toEqual(recorded);
    await expect(service.recordFact(actor, input, randomUUID(), randomUUID())).rejects.toBeDefined();
    expect(await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM quality_metric_facts WHERE organization_id = ${organizationId}::uuid AND source_record_key = ${input.sourceRecordKey}`).toHaveLength(1);
    await expect(service.recordFact(actor, { ...input, sourceRecordKey: randomUUID(), periodEnd: periodStart }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    await expect(service.recordFact(actor, { ...input, sourceRecordKey: randomUUID(), denominator: 0 }, randomUUID(), randomUUID())).rejects.toBeDefined();
  });

  it('keeps imported snapshots pending and prevents external facts from being forged', async () => {
    const metric = await definition();
    const input = { sourceSystem: 'MES' as const, externalRecordKey: randomUUID(), observedAt: new Date('2026-09-20T00:00:00Z'), payload: { batch: 'B-1', inspected: 100 } };
    const key = randomUUID();
    const snapshot = await service.createSnapshot(actor, input, randomUUID(), key);
    expect(snapshot).toMatchObject({ sourceSystem: 'MES', externalRecordKey: input.externalRecordKey, status: 'PENDING_REVIEW' });
    expect(await service.createSnapshot(actor, input, randomUUID(), key)).toEqual(snapshot);
    await expect(service.createSnapshot(actor, input, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.recordFact(actor, { metricDefinitionId: metric.id as string, periodStart, periodEnd, numerator: 90, denominator: 100, sourceSystem: 'MES', sourceRecordKey: input.externalRecordKey }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.recordFact(actor, { metricDefinitionId: metric.id as string, periodStart, periodEnd, numerator: 90, denominator: 100, sourceSystem: 'MANUAL', sourceSnapshotId: snapshot.id as string }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('rejects a fact linked to another organization’s snapshot at the database boundary', async () => {
    const metric = await definition();
    const snapshotId = randomUUID();
    await prisma.$executeRaw`INSERT INTO quality_data_snapshots (id, organization_id, source_system, external_record_key, observed_at, payload, recorded_by_id) VALUES (${snapshotId}::uuid, ${otherOrganizationId}::uuid, 'MES', ${randomUUID()}, ${periodStart}, '{}'::jsonb, ${otherUserId}::uuid)`;
    await expect(prisma.$executeRaw`INSERT INTO quality_metric_facts (id, organization_id, metric_definition_id, period_start, period_end, numerator, denominator, value, source_snapshot_id, source_system, recorded_by_id) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${metric.id}::uuid, ${periodStart}, ${periodEnd}, 1, 2, 0.5, ${snapshotId}::uuid, 'MES', ${userId}::uuid)`).rejects.toBeDefined();
    expect(await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM quality_metric_facts WHERE source_snapshot_id = ${snapshotId}::uuid`).toHaveLength(0);
  });

  it('enforces organization scope on definitions, facts, and trends', async () => {
    const metric = await definition();
    await expect(service.listDefinitions(actor, otherOrganizationId)).rejects.toMatchObject({ status: 403 });
    await expect(service.createDefinition(actor, { organizationId: otherOrganizationId, code: 'CROSS', name: '越权', unit: '%', numeratorLabel: 'A', denominatorLabel: 'B', formulaVersion: 'v1' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(service.recordFact(actor, { organizationId: otherOrganizationId, metricDefinitionId: metric.id as string, periodStart, periodEnd, numerator: 1, denominator: 2, sourceSystem: 'MANUAL' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(service.trend(actor, { organizationId: otherOrganizationId, limit: 10 })).rejects.toMatchObject({ status: 403 });
  });

  it('filters trend by inclusive period boundaries, metric, and limit', async () => {
    const metric = await definition();
    const otherMetric = await definition();
    const first = await service.recordFact(actor, { metricDefinitionId: metric.id as string, periodStart: new Date('2026-01-01T00:00:00Z'), periodEnd: new Date('2026-02-01T00:00:00Z'), numerator: 8, denominator: 10, sourceSystem: 'MANUAL', sourceRecordKey: randomUUID() }, randomUUID(), randomUUID());
    const second = await service.recordFact(actor, { metricDefinitionId: metric.id as string, periodStart: new Date('2026-02-01T00:00:00Z'), periodEnd: new Date('2026-03-01T00:00:00Z'), numerator: 9, denominator: 10, sourceSystem: 'MANUAL', sourceRecordKey: randomUUID() }, randomUUID(), randomUUID());
    await service.recordFact(actor, { metricDefinitionId: otherMetric.id as string, periodStart: new Date('2026-02-01T00:00:00Z'), periodEnd: new Date('2026-03-01T00:00:00Z'), numerator: 1, denominator: 2, sourceSystem: 'MANUAL', sourceRecordKey: randomUUID() }, randomUUID(), randomUUID());
    const query = { metricDefinitionId: metric.id as string, from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-03-01T00:00:00Z'), limit: 10 };
    expect((await service.trend(actor, query)).map((item) => item.id)).toEqual([second.id, first.id]);
    expect((await service.trend(actor, { ...query, limit: 1 })).map((item) => item.id)).toEqual([second.id]);
    expect(await service.trend(actor, { ...query, from: new Date('2026-01-01T00:00:00.001Z'), to: new Date('2026-02-28T23:59:59Z') })).toEqual([]);
  });

  it('drills into a manual fact without inventing a source link', async () => {
    const metric = await definition();
    const recorded = await service.recordFact(actor, { metricDefinitionId: metric.id as string, periodStart, periodEnd, numerator: 8, denominator: 10, sourceSystem: 'MANUAL', sourceRecordKey: randomUUID() }, randomUUID(), randomUUID());
    await expect(service.factDrilldown(actor, recorded.id as string, { expectedMetricVersion: 1 })).resolves.toMatchObject({ fact: { id: recorded.id }, snapshot: null, reason: 'NO_SOURCE_REFERENCE' });
    await expect(service.factDrilldown(actor, recorded.id as string, { organizationId: otherOrganizationId })).rejects.toMatchObject({ status: 403 });
    await expect(service.factDrilldown(actor, recorded.id as string, { expectedMetricVersion: 2 })).rejects.toMatchObject({ status: 409 });
  });

  it('drills from a verified internal snapshot to a current formal issue and ledger reference', async () => {
    const metric = await definition();
    const defectType = await prisma.processDefectType.create({ data: { organizationId, code: 'QD-DRILLDOWN', name: '下钻缺陷类型', createdById: userId } });
    drilldownDefectTypeIds.push(defectType.id);
    const defect = await prisma.processDefect.create({ data: {
      organizationId, defectTypeCode: 'QD-DRILLDOWN', description: '下钻来源', defectQuantity: 2,
      occurredAt: periodStart, responsibilityCategory: 'PROCESS', createdById: userId, updatedById: userId,
    } });
    drilldownDefectIds.push(defect.id);
    const problem = await prisma.problemIndex.create({ data: {
      organizationId, reportNumber: `QD-${randomUUID()}`, domainCode: 'PROCESS', problemType: 'DEFECT',
      sourceType: 'PROCESS_DEFECT', sourceId: defect.id, severity: 'LOW', createdById: userId,
    } });
    drilldownProblemIds.push(problem.id);
    const snapshot = await service.createInternalSnapshot(actor, {
      metricDefinitionId: metric.id, expectedMetricVersion: 1, problemIndexId: problem.id,
      expectedProblemVersion: problem.version, observedAt: periodStart,
    }, randomUUID(), 'qd-internal-snapshot-key');
    expect(snapshot).toMatchObject({ status: 'VERIFIED', sourceSystem: 'INTERNAL', problemIndexId: problem.id, problemVersion: 1 });
    const snapshotInput = { metricDefinitionId: metric.id as string, expectedMetricVersion: 1, problemIndexId: problem.id, expectedProblemVersion: 1, observedAt: periodStart };
    expect(await service.createInternalSnapshot(actor, snapshotInput, randomUUID(), 'qd-internal-snapshot-key')).toEqual(snapshot);
    await expect(service.createInternalSnapshot(actor, snapshotInput, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.createInternalSnapshot(actor, { ...snapshotInput, expectedMetricVersion: 2 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.createInternalSnapshot(actor, { ...snapshotInput, expectedProblemVersion: 2 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.createInternalSnapshot(actor, { ...snapshotInput, organizationId: otherOrganizationId }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const recorded = await service.recordFact(actor, {
      metricDefinitionId: metric.id as string, periodStart, periodEnd, numerator: 8, denominator: 10,
      sourceSystem: 'INTERNAL', sourceSnapshotId: snapshot.id,
    }, randomUUID(), 'qd-internal-fact-key');
    const factInput = { metricDefinitionId: metric.id as string, periodStart, periodEnd, numerator: 8, denominator: 10, sourceSystem: 'INTERNAL' as const, sourceSnapshotId: snapshot.id as string };
    expect(await service.recordFact(actor, factInput, randomUUID(), 'qd-internal-fact-key')).toEqual(recorded);
    await expect(service.recordFact(actor, factInput, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.recordFact(actor, { ...factInput, sourceRecordKey: 'forged' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.factDrilldown(actor, recorded.id as string, { expectedMetricVersion: 1 })).resolves.toMatchObject({
      fact: { id: recorded.id }, snapshot: { id: snapshot.id, status: 'VERIFIED' },
      source: { type: 'PROBLEM_INDEX', id: problem.id, version: 1, domainCode: 'PROCESS', domainSourceType: 'PROCESS_DEFECT', domainSourceId: defect.id },
      reason: null,
    });
    expect((await service.trend(actor, { metricDefinitionId: metric.id as string, limit: 10 })).map((item) => item.id)).toContain(recorded.id);
    const dashboard = await service.dashboard(actor, { metricDefinitionId: metric.id as string, limit: 10 });
    expect(dashboard.latestFacts).toEqual(expect.arrayContaining([expect.objectContaining({ id: recorded.id })]));
    expect(dashboard.cards).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'AVAILABLE', latestValue: 0.8 })]));
    await expect(service.factDrilldown(actor, recorded.id as string, { organizationId: otherOrganizationId })).rejects.toMatchObject({ status: 403 });
    const readPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'quality-data:metrics:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: readPermission.id } } });
    try { await expect(service.factDrilldown(actor, recorded.id as string, {})).rejects.toMatchObject({ status: 403 }); }
    finally { await prisma.rolePermission.create({ data: { roleId, permissionId: readPermission.id } }); }
    const concurrentInput = { ...factInput, periodStart: new Date('2026-11-01T00:00:00Z'), periodEnd: new Date('2026-12-01T00:00:00Z') };
    const concurrent = await Promise.allSettled([
      service.recordFact(actor, concurrentInput, randomUUID(), randomUUID()),
      service.recordFact(actor, concurrentInput, randomUUID(), randomUUID()),
    ]);
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((concurrent.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    await prisma.problemIndex.update({ where: { id: problem.id }, data: { version: { increment: 1 } } });
    await expect(service.factDrilldown(actor, recorded.id as string, {})).rejects.toMatchObject({ status: 409 });
    await expect(service.recordFact(actor, { ...factInput, periodStart: new Date('2027-01-01T00:00:00Z'), periodEnd: new Date('2027-02-01T00:00:00Z') }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('reads a pending raw snapshot only for the authorized organization', async () => {
    const snapshot = await service.createSnapshot(actor, { sourceSystem: 'MES', externalRecordKey: randomUUID(), observedAt: periodStart, payload: { batch: 'B-1' } }, randomUUID(), randomUUID());
    await expect(service.snapshotDetail(actor, snapshot.id as string, {})).resolves.toMatchObject({ id: snapshot.id, status: 'PENDING_REVIEW', payload: { batch: 'B-1' } });
    await expect(service.snapshotDetail(actor, snapshot.id as string, { organizationId: otherOrganizationId })).rejects.toMatchObject({ status: 403 });
    await expect(service.factDrilldown(actor, snapshot.id as string, {})).rejects.toMatchObject({ status: 404 });
  });

  it('blocks a fact linked to an unverified snapshot', async () => {
    const metric = await definition();
    const snapshot = await service.createSnapshot(actor, { sourceSystem: 'MES', externalRecordKey: randomUUID(), observedAt: periodStart, payload: { batch: 'B-2' } }, randomUUID(), randomUUID());
    const factId = randomUUID();
    await prisma.$executeRaw`INSERT INTO quality_metric_facts (id, organization_id, metric_definition_id, period_start, period_end, numerator, denominator, value, source_snapshot_id, source_system, recorded_by_id) VALUES (${factId}::uuid, ${organizationId}::uuid, ${metric.id}::uuid, ${periodStart}, ${periodEnd}, 1, 2, 0.5, ${snapshot.id}::uuid, 'MES', ${userId}::uuid)`;
    await expect(service.factDrilldown(actor, factId, {})).rejects.toMatchObject({ status: 409 });
  });

  it('rechecks read permission after it is revoked', async () => {
    const metric = await definition();
    const recorded = await service.recordFact(actor, { metricDefinitionId: metric.id as string, periodStart, periodEnd, numerator: 1, denominator: 2, sourceSystem: 'MANUAL', sourceRecordKey: randomUUID() }, randomUUID(), randomUUID());
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'quality-data:metrics:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: permission.id } } });
    try {
      await expect(service.factDrilldown(actor, recorded.id as string, {})).rejects.toMatchObject({ status: 403 });
      await expect(service.snapshotDetail(actor, randomUUID(), {})).rejects.toMatchObject({ status: 403 });
    } finally {
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
  });

  it('groups four business domains using eligible source facts and preserves scope', async () => {
    const domains = ['SUPPLIER', 'PROCESS', 'CUSTOMER', 'NEW_PRODUCT'] as const;
    const created = [];
    for (const domain of domains) {
      const metric = await service.createDefinition(actor, { code: `${domain}-${randomUUID().slice(0, 8)}`, name: domain, domain, unit: '%', numeratorLabel: '合格数', denominatorLabel: '总数', formulaVersion: 'v1' }, randomUUID(), randomUUID());
      created.push(metric);
      await service.recordFact(actor, { metricDefinitionId: metric.id as string, periodStart, periodEnd, numerator: 9, denominator: 10, sourceSystem: 'MANUAL', sourceRecordKey: randomUUID() }, randomUUID(), randomUUID());
    }
    const snapshot = await service.createSnapshot(actor, { sourceSystem: 'MES', externalRecordKey: randomUUID(), observedAt: periodStart, payload: { batch: 'pending' } }, randomUUID(), randomUUID());
    const pendingId = randomUUID();
    await prisma.$executeRaw`INSERT INTO quality_metric_facts (id, organization_id, metric_definition_id, period_start, period_end, numerator, denominator, value, source_snapshot_id, source_system, recorded_by_id) VALUES (${pendingId}::uuid, ${organizationId}::uuid, ${created[1]!.id}::uuid, ${new Date('2026-10-01T00:00:00Z')}, ${new Date('2026-11-01T00:00:00Z')}, 1, 1, 1, ${snapshot.id}::uuid, 'MES', ${userId}::uuid)`;
    const dashboard = await service.dashboard(actor, { limit: 100 });
    for (const domain of domains.filter((domain) => domain !== 'PROCESS')) expect(dashboard.cards).toEqual(expect.arrayContaining([expect.objectContaining({ domain, status: 'MANUAL', latestValue: 0.9 })]));
    expect(dashboard.latestFacts.some((item: { id: unknown }) => item.id === pendingId)).toBe(false);
    expect(dashboard.cards.find((item: { domain: string; status: string }) => item.domain === 'PROCESS' && item.status === 'PENDING_REVIEW')).toBeDefined();
    await expect(service.dashboard(actor, { organizationId: otherOrganizationId, limit: 100 })).rejects.toMatchObject({ status: 403 });
    const filtered = await service.dashboard(actor, { domain: 'SUPPLIER', limit: 100 });
    expect(filtered.cards.map((card: { domain: string }) => card.domain)).toEqual(['SUPPLIER']);
  });

  it('excludes unverified external facts from trends and latest values', async () => {
    const metric = await definition();
    const factId = randomUUID();
    await prisma.$executeRaw`INSERT INTO quality_metric_facts (id, organization_id, metric_definition_id, period_start, period_end, numerator, denominator, value, source_system, recorded_by_id) VALUES (${factId}::uuid, ${organizationId}::uuid, ${metric.id}::uuid, ${periodStart}, ${periodEnd}, 1, 2, 0.5, 'MES', ${userId}::uuid)`;
    expect(await service.trend(actor, { metricDefinitionId: metric.id as string, limit: 10 })).toEqual([]);
    expect((await service.dashboard(actor, { metricDefinitionId: metric.id as string, limit: 10 })).latestFacts).toEqual([]);
    await expect(service.factDrilldown(actor, factId, {})).rejects.toMatchObject({ status: 409 });
  });

  it('applies the metric filter to cards and always describes all four domains', async () => {
    const metric = await definition();
    const report = await service.dashboard(actor, { metricDefinitionId: metric.id as string, limit: 10 });
    expect(report.cards.map((card) => card.metricCode)).toEqual([metric.code]);
    expect(report.domains.map((domain) => domain.domain)).toEqual(expect.arrayContaining(['SUPPLIER', 'PROCESS', 'CUSTOMER', 'NEW_PRODUCT']));
  });

  it('explains manual ratio changes without treating direction as quality improvement', async () => {
    const metric = await definition();
    const query = { metricDefinitionId: metric.id as string, limit: 10 };
    expect(await service.insights(actor, query)).toEqual([expect.objectContaining({ signal: 'INSUFFICIENT_DATA', generatedBy: 'RULE_BASED' })]);
    await service.recordFact(actor, { metricDefinitionId: metric.id as string, periodStart: new Date('2026-01-01T00:00:00Z'), periodEnd: new Date('2026-02-01T00:00:00Z'), numerator: 8, denominator: 10, sourceSystem: 'MANUAL', sourceRecordKey: randomUUID() }, randomUUID(), randomUUID());
    await service.recordFact(actor, { metricDefinitionId: metric.id as string, periodStart: new Date('2026-02-01T00:00:00Z'), periodEnd: new Date('2026-03-01T00:00:00Z'), numerator: 9, denominator: 10, sourceSystem: 'MANUAL', sourceRecordKey: randomUUID() }, randomUUID(), randomUUID());
    expect(await service.insights(actor, query)).toEqual([expect.objectContaining({ signal: 'RISING', generatedBy: 'RULE_BASED' })]);
    await expect(service.insights(actor, { ...query, organizationId: otherOrganizationId })).rejects.toMatchObject({ status: 403 });
  });

  it('rejects reversed reporting periods', async () => {
    await expect(service.dashboard(actor, { from: periodEnd, to: periodStart, limit: 10 })).rejects.toMatchObject({ status: 400 });
    await expect(service.trend(actor, { from: periodEnd, to: periodStart, limit: 10 })).rejects.toMatchObject({ status: 400 });
  });
});
