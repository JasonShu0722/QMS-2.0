import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { ProblemIndexService } from '../problem-index/problem-index.service.js';
import { QUALITY_DASHBOARD_DOMAINS, type CreateInternalQualitySnapshotDto, type CreateMetricDefinitionDto, type CreateQualitySnapshotDto, type MetricTrendQueryDto, type QualityFactDrilldownQueryDto, type QualityDataScopeDto, type QualityDashboardCardDto, type QualityDashboardDomain, type QualityDashboardQueryDto, type RecordMetricFactDto } from './quality-data.dto.js';
import { abnormalPeriodSummary, calculateQualityMetric, getQualityMetricProfile } from './quality-metric.rules.js';

type Row = Record<string, unknown>;
type ProblemReadClient = NonNullable<Parameters<ProblemIndexService['findById']>[2]>;
const READ = 'quality-data:metrics:read';
const WRITE = 'quality-data:metrics:write';

function validateRange(query: { from?: Date; to?: Date }) {
  if (query.from && query.to && query.to <= query.from) throw new HttpException({ code: 'QUALITY_METRIC_PERIOD_INVALID', message: '统计结束时间必须晚于开始时间' }, 400);
}

function number(value: unknown): number { return Number(value); }
function metric(row: Row) {
  const profile = getQualityMetricProfile(String(row.formula_code ?? row.code));
  const green = row.green_threshold == null ? null : number(row.green_threshold);
  const yellow = row.yellow_threshold == null ? null : number(row.yellow_threshold);
  return { id: row.id, organizationId: row.organization_id, code: row.code, name: row.name, domain: row.domain ?? 'UNSPECIFIED', unit: row.unit, numeratorLabel: row.numerator_label, denominatorLabel: row.denominator_label, formulaVersion: row.formula_version, active: row.active, version: row.version,
    formulaCode: row.formula_code ?? 'RATIO', thresholdDirection: row.threshold_direction ?? profile.direction, greenThreshold: row.green_threshold == null ? null : green, yellowThreshold: row.yellow_threshold == null ? null : yellow, abnormalPeriodLimit: number(row.abnormal_period_limit ?? 1),
    resolvedFormulaCode: String(row.formula_code ?? row.code), resolvedThresholdDirection: String(row.threshold_direction ?? profile.direction), resolvedGreenThreshold: green, resolvedYellowThreshold: yellow, resolvedAbnormalPeriodLimit: number(row.abnormal_period_limit ?? 1) };
}
function fact(row: Row) {
  return { id: row.id, organizationId: row.organization_id, metricDefinitionId: row.metric_definition_id, periodStart: new Date(String(row.period_start)).toISOString(), periodEnd: new Date(String(row.period_end)).toISOString(), numerator: number(row.numerator), denominator: number(row.denominator), value: number(row.value), sourceSystem: row.source_system, sourceRecordKey: row.source_record_key ?? null };
}
function sourceError(): never { throw new HttpException({ code: 'QUALITY_SOURCE_NOT_VERIFIED', message: '来源未核实或已失效' }, 409); }
function staleError(): never { throw new HttpException({ code: 'QUALITY_SOURCE_STALE', message: '来源记录或口径版本已变化' }, 409); }
function snapshot(row: Row) {
  return { id: row.id, sourceSystem: row.source_system, externalRecordKey: row.external_record_key,
    observedAt: new Date(String(row.observed_at)).toISOString(), status: row.status,
    problemIndexId: row.problem_index_id ?? null, problemVersion: row.problem_version == null ? null : number(row.problem_version) };
}

@Injectable()
export class QualityDataService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly problems: ProblemIndexService) {}

  private async verifiedSource(tx: Prisma.TransactionClient, organizationId: string, row: Row, metricDefinitionId: string, metricVersion: number) {
    if (row.status !== 'VERIFIED' || row.source_system !== 'INTERNAL' || row.metric_definition_id !== metricDefinitionId) sourceError();
    if (number(row.metric_version) !== metricVersion) staleError();
    let problem: Row;
    try { problem = await this.problems.findById(String(row.problem_index_id), organizationId, tx as unknown as ProblemReadClient) as Row; }
    catch (error) { if ((error as { status?: number }).status === 404) staleError(); throw error; }
    if (problem.archivedAt || problem.status === 'ARCHIVED' || number(problem.version) !== number(row.problem_version)
      || problem.domainCode !== row.domain_code || problem.sourceType !== row.domain_source_type
      || problem.sourceId !== row.domain_source_id || !problem.sourceId) staleError();
    return { type: 'PROBLEM_INDEX' as const, id: problem.id, version: number(problem.version), domainCode: problem.domainCode,
      domainSourceType: problem.sourceType, domainSourceId: problem.sourceId };
  }

  private async eligibleFact(tx: Prisma.TransactionClient, organizationId: string, row: Row): Promise<boolean> {
    if (!row.source_snapshot_id) return row.source_system === 'MANUAL';
    if (row.source_system !== 'INTERNAL') return false;
    const snapshots = await tx.$queryRaw<Row[]>`SELECT * FROM quality_data_snapshots WHERE organization_id = ${organizationId}::uuid AND id = ${row.source_snapshot_id}::uuid`;
    const source = snapshots[0];
    if (!source || row.source_record_key !== source.external_record_key) return false;
    const definitions = await tx.$queryRaw<Row[]>`SELECT version FROM quality_metric_definitions WHERE organization_id = ${organizationId}::uuid AND id = ${row.metric_definition_id}::uuid`;
    if (!definitions[0]) return false;
    try { await this.verifiedSource(tx, organizationId, source, String(row.metric_definition_id), number(definitions[0].version)); return true; }
    catch (error) { if ((error as { status?: number }).status === 409) return false; throw error; }
  }

  async listDefinitions(actor: AdminActor, organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, READ);
      const rows = await tx.$queryRaw<Row[]>`SELECT * FROM quality_metric_definitions WHERE organization_id = ${organizationId}::uuid ORDER BY code`;
      return rows.map(metric);
    });
  }

  async createDefinition(actor: AdminActor, input: CreateMetricDefinitionDto, traceId: string, key: string | undefined) {
    const organizationId = input.organizationId ?? actor.organizationId;
    if ((input.greenThreshold == null) !== (input.yellowThreshold == null)) throw new HttpException({ code: 'QUALITY_METRIC_THRESHOLD_INVALID', message: '红绿灯阈值必须成对填写' }, 400);
    if (input.greenThreshold != null && input.yellowThreshold != null && (input.thresholdDirection ?? getQualityMetricProfile(input.formulaCode ?? input.code).direction) === 'GTE' && input.greenThreshold < input.yellowThreshold) throw new HttpException({ code: 'QUALITY_METRIC_THRESHOLD_INVALID', message: '达标阈值不得低于预警阈值' }, 400);
    if (input.greenThreshold != null && input.yellowThreshold != null && (input.thresholdDirection ?? getQualityMetricProfile(input.formulaCode ?? input.code).direction) === 'LTE' && input.greenThreshold > input.yellowThreshold) throw new HttpException({ code: 'QUALITY_METRIC_THRESHOLD_INVALID', message: '达标阈值不得高于预警阈值' }, 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'QUALITY_METRIC_DEFINITION_CREATED', payload: input, permission: WRITE, duplicateCode: 'CONCURRENCY_CONFLICT' }, async (tx) => {
      const id = randomUUID();
      const profile = getQualityMetricProfile(input.formulaCode ?? input.code, { direction: input.thresholdDirection, thresholds: input.greenThreshold == null || input.yellowThreshold == null ? undefined : { green: input.greenThreshold, yellow: input.yellowThreshold } });
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO quality_metric_definitions (id, organization_id, code, name, domain, unit, numerator_label, denominator_label, formula_version, formula_code, threshold_direction, green_threshold, yellow_threshold, abnormal_period_limit, created_by_id, updated_by_id) VALUES (${id}::uuid, ${organizationId}::uuid, ${input.code}, ${input.name}, ${input.domain ?? 'UNSPECIFIED'}, ${input.unit}, ${input.numeratorLabel}, ${input.denominatorLabel}, ${input.formulaVersion}, ${input.formulaCode ?? input.code}, ${input.thresholdDirection ?? profile.direction}, ${input.greenThreshold ?? null}, ${input.yellowThreshold ?? null}, ${input.abnormalPeriodLimit ?? 1}, ${actor.id}::uuid, ${actor.id}::uuid) ON CONFLICT (organization_id, code) DO NOTHING RETURNING *`;
      if (!rows[0]) throw new HttpException({ code: 'CONCURRENCY_CONFLICT', message: '指标编码已存在' }, 409);
      return metric(rows[0]!);
    });
  }

  async recordFact(actor: AdminActor, input: RecordMetricFactDto, traceId: string, key: string | undefined) {
    const organizationId = input.organizationId ?? actor.organizationId;
    if (input.periodEnd <= input.periodStart) throw new HttpException({ code: 'QUALITY_METRIC_PERIOD_INVALID', message: '统计结束时间必须晚于开始时间' }, 400);
    if (input.numerator > input.denominator) throw new HttpException({ code: 'QUALITY_METRIC_NUMERATOR_INVALID', message: '分子不得超过分母' }, 400);
    if (input.sourceSystem !== 'MANUAL' && input.sourceSystem !== 'INTERNAL') sourceError();
    if (input.sourceSystem === 'MANUAL' && input.sourceSnapshotId) sourceError();
    if (input.sourceSystem === 'INTERNAL' && !input.sourceSnapshotId) sourceError();
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'QUALITY_METRIC_FACT_RECORDED', payload: { ...input, periodStart: input.periodStart.toISOString(), periodEnd: input.periodEnd.toISOString() }, permission: WRITE, duplicateCode: 'CONCURRENCY_CONFLICT' }, async (tx) => {
      const id = randomUUID();
      const dimensions = input.dimensions ?? {};
      let sourceRecordKey = input.sourceRecordKey ?? null;
      const definitions = await tx.$queryRaw<Row[]>`SELECT * FROM quality_metric_definitions WHERE organization_id = ${organizationId}::uuid AND id = ${input.metricDefinitionId}::uuid`;
      if (!definitions[0]) sourceError();
      const definition = definitions[0]!;
      const value = calculateQualityMetric(String(definition.formula_code ?? definition.code), input.numerator, input.denominator);
      if (input.sourceSystem === 'INTERNAL') {
        const snapshots = await tx.$queryRaw<Row[]>`SELECT * FROM quality_data_snapshots WHERE organization_id = ${organizationId}::uuid AND id = ${input.sourceSnapshotId}::uuid`;
        if (!snapshots[0]) sourceError();
        await this.verifiedSource(tx, organizationId, snapshots[0], input.metricDefinitionId, number(definition.version));
        if (sourceRecordKey && sourceRecordKey !== snapshots[0].external_record_key) sourceError();
        sourceRecordKey = String(snapshots[0].external_record_key);
      }
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO quality_metric_facts (id, organization_id, metric_definition_id, period_start, period_end, numerator, denominator, value, source_snapshot_id, source_system, source_record_key, dimensions, recorded_by_id) VALUES (${id}::uuid, ${organizationId}::uuid, ${input.metricDefinitionId}::uuid, ${input.periodStart}, ${input.periodEnd}, ${input.numerator}, ${input.denominator}, ${value}, ${input.sourceSnapshotId ?? null}::uuid, ${input.sourceSystem}, ${sourceRecordKey}, ${JSON.stringify(dimensions)}::jsonb, ${actor.id}::uuid) ON CONFLICT (organization_id, metric_definition_id, period_start, period_end, source_system, source_record_key) DO NOTHING RETURNING *`);
      if (!rows[0]) throw new HttpException({ code: 'CONCURRENCY_CONFLICT', message: '指标事实已存在' }, 409);
      return fact(rows[0]!);
    });
  }

  async createSnapshot(actor: AdminActor, input: CreateQualitySnapshotDto, traceId: string, key: string | undefined) {
    if (!['IMS', 'MES', 'ERP', 'SAP'].includes(input.sourceSystem)) sourceError();
    const organizationId = input.organizationId ?? actor.organizationId;
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'QUALITY_DATA_SNAPSHOT_RECORDED', payload: input, permission: WRITE, duplicateCode: 'CONCURRENCY_CONFLICT' }, async (tx) => {
      const id = randomUUID();
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO quality_data_snapshots (id, organization_id, source_system, external_record_key, observed_at, payload, recorded_by_id) VALUES (${id}::uuid, ${organizationId}::uuid, ${input.sourceSystem}, ${input.externalRecordKey}, ${input.observedAt}, ${JSON.stringify(input.payload)}::jsonb, ${actor.id}::uuid) ON CONFLICT (organization_id, source_system, external_record_key) DO NOTHING RETURNING *`;
      if (!rows[0]) throw new HttpException({ code: 'CONCURRENCY_CONFLICT', message: '来源记录已存在' }, 409);
      const row = rows[0]!;
      return { id: row.id, sourceSystem: row.source_system, externalRecordKey: row.external_record_key, observedAt: new Date(String(row.observed_at)).toISOString(), status: row.status };
    });
  }

  async createInternalSnapshot(actor: AdminActor, input: CreateInternalQualitySnapshotDto, traceId: string, key: string | undefined) {
    const organizationId = input.organizationId ?? actor.organizationId;
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'QUALITY_INTERNAL_SOURCE_VERIFIED',
      payload: { ...input, observedAt: input.observedAt.toISOString() }, permission: WRITE, duplicateCode: 'CONCURRENCY_CONFLICT' }, async (tx) => {
      const metrics = await tx.$queryRaw<Row[]>`SELECT version FROM quality_metric_definitions WHERE organization_id = ${organizationId}::uuid AND id = ${input.metricDefinitionId}::uuid`;
      if (!metrics[0] || number(metrics[0].version) !== input.expectedMetricVersion) staleError();
      let problem: Row;
      try { problem = await this.problems.findById(input.problemIndexId, organizationId, tx as unknown as ProblemReadClient) as Row; }
      catch (error) { if ((error as { status?: number }).status === 404) staleError(); throw error; }
      if (problem.archivedAt || problem.status === 'ARCHIVED' || number(problem.version) !== input.expectedProblemVersion
        || !problem.domainCode || !problem.sourceType || !problem.sourceId) staleError();
      const id = randomUUID();
      const sourceKey = `PROBLEM_INDEX:${input.problemIndexId}:${input.expectedProblemVersion}:${input.metricDefinitionId}:${input.expectedMetricVersion}`;
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO quality_data_snapshots (id, organization_id, source_system, external_record_key, observed_at, payload, status, recorded_by_id, metric_definition_id, metric_version, problem_index_id, problem_version, domain_code, domain_source_type, domain_source_id, verified_by_id, verified_at)
        VALUES (${id}::uuid, ${organizationId}::uuid, 'INTERNAL', ${sourceKey}, ${input.observedAt}, ${JSON.stringify({ sourceType: 'PROBLEM_INDEX' })}::jsonb, 'VERIFIED', ${actor.id}::uuid,
        ${input.metricDefinitionId}::uuid, ${input.expectedMetricVersion}, ${input.problemIndexId}::uuid, ${input.expectedProblemVersion}, ${String(problem.domainCode)}, ${String(problem.sourceType)}, ${String(problem.sourceId)}::uuid, ${actor.id}::uuid, CURRENT_TIMESTAMP)
        ON CONFLICT (organization_id, source_system, external_record_key) DO NOTHING RETURNING *`);
      if (!rows[0]) throw new HttpException({ code: 'CONCURRENCY_CONFLICT', message: '来源快照已存在' }, 409);
      return snapshot(rows[0]);
    });
  }

  async snapshotDetail(actor: AdminActor, id: string, query: QualityDataScopeDto) {
    const organizationId = query.organizationId ?? actor.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, READ);
      const rows = await tx.$queryRaw<Row[]>`SELECT * FROM quality_data_snapshots WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid`;
      const row = rows[0];
      if (!row) throw new HttpException({ code: 'QUALITY_SNAPSHOT_NOT_FOUND', message: '来源快照不存在' }, 404);
      return { id: row.id, sourceSystem: row.source_system, externalRecordKey: row.external_record_key, observedAt: new Date(String(row.observed_at)).toISOString(), status: row.status, payload: row.payload };
    });
  }

  async factDrilldown(actor: AdminActor, id: string, query: QualityFactDrilldownQueryDto) {
    const organizationId = query.organizationId ?? actor.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, READ);
      const rows = await tx.$queryRaw<Row[]>`SELECT f.*, d.version AS metric_version FROM quality_metric_facts f JOIN quality_metric_definitions d ON d.organization_id = f.organization_id AND d.id = f.metric_definition_id WHERE f.organization_id = ${organizationId}::uuid AND f.id = ${id}::uuid`;
      const row = rows[0];
      if (!row) throw new HttpException({ code: 'QUALITY_FACT_NOT_FOUND', message: '指标事实不存在' }, 404);
      if (query.expectedMetricVersion !== undefined && query.expectedMetricVersion !== number(row.metric_version)) throw new HttpException({ code: 'QUALITY_METRIC_VERSION_STALE', message: '指标口径版本已变化，请刷新后查看' }, 409);
      if (!row.source_snapshot_id && row.source_system === 'MANUAL') return { fact: fact(row), snapshot: null, source: null, reason: 'NO_SOURCE_REFERENCE' };
      if (!row.source_snapshot_id || row.source_system !== 'INTERNAL') sourceError();
      const snapshots = await tx.$queryRaw<Row[]>`SELECT * FROM quality_data_snapshots WHERE organization_id = ${organizationId}::uuid AND id = ${row.source_snapshot_id}::uuid`;
      if (!snapshots[0]) sourceError();
      const source = await this.verifiedSource(tx, organizationId, snapshots[0], String(row.metric_definition_id), number(row.metric_version));
      if (row.source_record_key !== snapshots[0].external_record_key) staleError();
      return { fact: fact(row), snapshot: snapshot(snapshots[0]), source, reason: null };
    });
  }

  async trend(actor: AdminActor, query: MetricTrendQueryDto) {
    validateRange(query);
    const organizationId = query.organizationId ?? actor.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, READ);
      const filters = [Prisma.sql`organization_id = ${organizationId}::uuid`];
      if (query.metricDefinitionId) filters.push(Prisma.sql`metric_definition_id = ${query.metricDefinitionId}::uuid`);
      if (query.from) filters.push(Prisma.sql`period_start >= ${query.from}`);
      if (query.to) filters.push(Prisma.sql`period_end <= ${query.to}`);
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM quality_metric_facts WHERE ${Prisma.join(filters, ' AND ')} ORDER BY period_start DESC`);
      const eligible = [];
      for (const row of rows) {
        if (await this.eligibleFact(tx, organizationId, row)) eligible.push(fact(row));
        if (eligible.length >= query.limit) break;
      }
      return eligible;
    });
  }

  async dashboard(actor: AdminActor, query: QualityDashboardQueryDto) {
    validateRange(query);
    const organizationId = query.organizationId ?? actor.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, READ);
      const definitionFilters = [Prisma.sql`organization_id = ${organizationId}::uuid`, Prisma.sql`active = true`];
      if (query.domain) definitionFilters.push(Prisma.sql`domain = ${query.domain}`);
      if (query.metricDefinitionId) definitionFilters.push(Prisma.sql`id = ${query.metricDefinitionId}::uuid`);
      const definitions = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM quality_metric_definitions WHERE ${Prisma.join(definitionFilters, ' AND ')} ORDER BY code`);
      const filters = [Prisma.sql`organization_id = ${organizationId}::uuid`];
      if (query.metricDefinitionId) filters.push(Prisma.sql`metric_definition_id = ${query.metricDefinitionId}::uuid`);
      if (query.from) filters.push(Prisma.sql`period_start >= ${query.from}`);
      if (query.to) filters.push(Prisma.sql`period_end <= ${query.to}`);
      if (query.domain) filters.push(Prisma.sql`metric_definition_id IN (SELECT id FROM quality_metric_definitions WHERE organization_id = ${organizationId}::uuid AND domain = ${query.domain})`);
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT DISTINCT ON (metric_definition_id) * FROM quality_metric_facts WHERE ${Prisma.join(filters, ' AND ')} ORDER BY metric_definition_id, period_start DESC, recorded_at DESC, id DESC LIMIT ${query.limit}`);
      const allRows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY metric_definition_id ORDER BY period_start DESC, recorded_at DESC, id DESC) AS period_rank FROM quality_metric_facts WHERE ${Prisma.join(filters, ' AND ')}) ranked WHERE period_rank <= 500 ORDER BY period_start DESC`);
      const eligibleIds = new Set<string>();
      for (const row of allRows) if (await this.eligibleFact(tx, organizationId, row)) eligibleIds.add(String(row.id));
      const latestFacts = rows.filter((row) => eligibleIds.has(String(row.id))).map(fact);
      const cards: QualityDashboardCardDto[] = definitions.map((definition) => {
        const row = rows.find((candidate) => candidate.metric_definition_id === definition.id);
        const domain = String(definition.domain ?? 'UNSPECIFIED') as QualityDashboardDomain | 'UNSPECIFIED';
        const profileBase = getQualityMetricProfile(String(definition.formula_code ?? definition.code), { direction: String(definition.threshold_direction ?? '') === 'LTE' ? 'LTE' : undefined, thresholds: definition.green_threshold == null || definition.yellow_threshold == null ? undefined : { green: number(definition.green_threshold), yellow: number(definition.yellow_threshold) } });
        if (!row) return { domain, metricCode: String(definition.code), metricName: String(definition.name), unit: String(definition.unit), status: 'NO_DATA', latestValue: null, numerator: null, denominator: null, sourceSystem: null, sourceRecordKey: null, periodStart: null, periodEnd: null, signal: 'NO_DATA' as const, abnormalPeriods: 0, consecutiveRedPeriods: 0, alert: false };
        const available = eligibleIds.has(String(row.id));
        const manual = available && !row.source_snapshot_id;
        if (!available) return { domain, metricCode: String(definition.code), metricName: String(definition.name), unit: String(definition.unit), status: 'PENDING_REVIEW' as const, latestValue: null, numerator: null, denominator: null, sourceSystem: String(row.source_system), sourceRecordKey: row.source_record_key == null ? null : String(row.source_record_key), periodStart: new Date(String(row.period_start)).toISOString(), periodEnd: new Date(String(row.period_end)).toISOString(), signal: 'NO_DATA' as const, abnormalPeriods: 0, consecutiveRedPeriods: 0, alert: false };
        const recentRows = allRows.filter((candidate) => candidate.metric_definition_id === definition.id && eligibleIds.has(String(candidate.id))).map((candidate) => Number(candidate.value));
        const summary = abnormalPeriodSummary(recentRows.length ? recentRows : [Number(row.value)], profileBase);
        return { domain, metricCode: String(definition.code), metricName: String(definition.name), unit: String(definition.unit), status: manual ? 'MANUAL' : 'AVAILABLE', latestValue: Number(row.value), numerator: Number(row.numerator), denominator: Number(row.denominator), sourceSystem: String(row.source_system), sourceRecordKey: row.source_record_key == null ? null : String(row.source_record_key), periodStart: new Date(String(row.period_start)).toISOString(), periodEnd: new Date(String(row.period_end)).toISOString(), signal: summary.signal, abnormalPeriods: summary.abnormalPeriods, consecutiveRedPeriods: summary.consecutiveRedPeriods, alert: summary.signal === 'YELLOW' || (summary.signal === 'RED' && summary.consecutiveRedPeriods >= number(definition.abnormal_period_limit ?? 1)) };
      });
      const domains = [...QUALITY_DASHBOARD_DOMAINS, 'UNSPECIFIED' as const].map((domain) => ({ domain, label: domain === 'UNSPECIFIED' ? '未分类' : domain, factCount: cards.filter((card) => card.domain === domain && card.status !== 'NO_DATA').length, metricCount: cards.filter((card) => card.domain === domain).length }));
      return { generatedAt: new Date().toISOString(), from: query.from?.toISOString() ?? null, to: query.to?.toISOString() ?? null, metrics: definitions.map(metric), latestFacts, domains, cards };
    });
  }

  async insights(actor: AdminActor, query: MetricTrendQueryDto) {
    validateRange(query);
    const organizationId = query.organizationId ?? actor.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, READ);
      const definitions = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, code, name FROM quality_metric_definitions WHERE organization_id = ${organizationId}::uuid AND active = true ${query.metricDefinitionId ? Prisma.sql`AND id = ${query.metricDefinitionId}::uuid` : Prisma.empty} ORDER BY code`);
      const results = [];
      for (const definition of definitions) {
        const filters = [Prisma.sql`organization_id = ${organizationId}::uuid`, Prisma.sql`metric_definition_id = ${definition.id}::uuid`, Prisma.sql`source_snapshot_id IS NULL`, Prisma.sql`source_system = 'MANUAL'`];
        if (query.from) filters.push(Prisma.sql`period_start >= ${query.from}`);
        if (query.to) filters.push(Prisma.sql`period_end <= ${query.to}`);
        const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT value, period_start, period_end FROM quality_metric_facts WHERE ${Prisma.join(filters, ' AND ')} ORDER BY period_start DESC LIMIT 2`);
        const current = rows[0];
        const previous = rows[1];
        if (!current || !previous) {
          results.push({ metricDefinitionId: definition.id, metricCode: definition.code, metricName: definition.name, signal: 'INSUFFICIENT_DATA', summary: '尚无足够的已核实事实进行趋势分析', evidence: [`已核实统计期间：${rows.length}`], generatedBy: 'RULE_BASED' });
          continue;
        }
        const currentValue = Number(current.value);
        const previousValue = Number(previous.value);
        const delta = currentValue - previousValue;
        const relative = previousValue === 0 ? 0 : Math.abs(delta / previousValue);
        const signal = relative < 0.05 ? 'STABLE' : delta > 0 ? 'RISING' : 'FALLING';
        results.push({ metricDefinitionId: definition.id, metricCode: definition.code, metricName: definition.name, signal, summary: signal === 'STABLE' ? '最近两个统计期间变化低于 5%' : signal === 'RISING' ? '最近一个统计期间的原始比值上升' : '最近一个统计期间的原始比值下降', evidence: [`当前值：${currentValue}`, `前期值：${previousValue}`, `变化：${delta.toFixed(4)}`], generatedBy: 'RULE_BASED' });
      }
      return results;
    });
  }
}
