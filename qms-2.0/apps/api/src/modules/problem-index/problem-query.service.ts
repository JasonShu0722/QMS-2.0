import { BadRequestException, Injectable } from '@nestjs/common';
import { validateSync, isUUID } from 'class-validator';
import { Prisma, type ProblemIndex } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { assertWorkflowFeature, featurePredicate, type WorkflowActor } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import { ProblemDomainRegistry, type ProblemDomainSummary, type ProblemFollowupFacts, type ProblemReadPurpose } from './problem-domain-registry.js';
import { ProblemIndexQueryDto, ProcessFollowupQueryDto, type ProblemIndexPageResponseDto, type ProblemIndexResponseDto, type ProblemStatusCountDto, type ProcessFollowupPageResponseDto, type ProcessFollowupStage } from './problem-index.dto.js';
import { summaryProjection } from './problem-domain-projection.js';

const indexColumns = Prisma.sql`p.id, p.organization_id AS "organizationId", p.report_number AS "reportNumber", p.domain_code AS "domainCode", p.problem_type AS "problemType", p.source_type AS "sourceType", p.source_id AS "sourceId", p.status, p.severity, p.responsible_party AS "responsibleParty", p.owner_id AS "ownerId", p.workflow_instance_id AS "workflowInstanceId", p.closed_at AS "closedAt", p.archived_at AS "archivedAt", p.version, p.created_by_id AS "createdById", p.updated_by_id AS "updatedById", p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;
const columns = Prisma.sql`${indexColumns}, p.due_at AS "dueAt"`;
const ordering = { createdAt: Prisma.sql`"createdAt"`, updatedAt: Prisma.sql`"updatedAt"`, dueAt: Prisma.sql`"dueAt"`, reportNumber: Prisma.sql`"reportNumber"`, status: Prisma.sql`status`, severity: Prisma.sql`severity` };
type FollowupRow = ProblemIndex & ProblemFollowupFacts & { stage: ProcessFollowupStage; responsibleSectionDepartmentId: string };

function searchPattern(search?: string): string | undefined {
  const value = search?.trim();
  return value ? `%${value.replace(/[\\%_]/g, '\\$&')}%` : undefined;
}

async function readPage<Row>(tx: Prisma.TransactionClient, eligible: Prisma.Sql, query: Pick<ProblemIndexQueryDto, 'page' | 'pageSize' | 'sortBy' | 'sortDirection'>) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const direction = query.sortDirection === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const order = Prisma.sql`${ordering[query.sortBy ?? 'createdAt']} ${direction} NULLS LAST, id ${direction}`;
  const [result] = await tx.$queryRaw<{ total: number; items: Row[]; statusCounts: ProblemStatusCountDto[] }[]>(Prisma.sql`
    WITH eligible AS MATERIALIZED (${eligible}),
    selected AS (SELECT * FROM eligible ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}),
    counts AS (SELECT status, count(*)::int AS count FROM eligible GROUP BY status)
    SELECT (SELECT count(*)::int FROM eligible) AS total,
      COALESCE((SELECT jsonb_agg(selected ORDER BY ${order}) FROM selected), '[]'::jsonb) AS items,
      COALESCE((SELECT jsonb_agg(counts ORDER BY status) FROM counts), '[]'::jsonb) AS "statusCounts"`);
  return { ...result!, page, pageSize };
}

export function problemDto(problem: ProblemIndex, summary: ProblemDomainSummary): ProblemIndexResponseDto {
  return { id: problem.id, organizationId: problem.organizationId, reportNumber: problem.reportNumber, domainCode: problem.domainCode,
    problemType: problem.problemType, sourceType: problem.sourceType, sourceId: problem.sourceId!, status: problem.status, severity: problem.severity,
    responsibleParty: problem.responsibleParty, ownerId: problem.ownerId, dueAt: problem.dueAt ? new Date(problem.dueAt).toISOString() : null,
    createdAt: new Date(problem.createdAt).toISOString(), updatedAt: new Date(problem.updatedAt).toISOString(), version: problem.version,
    summary: summaryProjection(summary) };
}

@Injectable()
export class ProblemQueryService {
  constructor(private readonly prisma: PrismaService, private readonly registry: ProblemDomainRegistry) {}

  async authenticate(tx: Prisma.TransactionClient, actor: WorkflowActor, organizationId: string): Promise<void> {
    if (!isUUID(organizationId)) throw new BadRequestException();
    const current = await assertActiveAuthentication(tx, actor);
    if (current.user.organizationId !== actor.organizationId || current.user.accountType !== actor.accountType) workflowError('AUTH_SESSION_REQUIRED', 401);
    await assertWorkflowFeature(tx, actor, organizationId, 'problem-index:read');
  }

  async authorized(tx: Prisma.TransactionClient, actor: WorkflowActor, organizationId: string, id: string, purpose: ProblemReadPurpose) {
    if (!isUUID(id)) throw new BadRequestException();
    await assertWorkflowFeature(tx, actor, organizationId, 'problem-index:read');
    const [problem] = await tx.$queryRaw<ProblemIndex[]>(Prisma.sql`SELECT ${columns} FROM problem_indexes p WHERE p.id = ${id}::uuid AND ${this.scope(actor, organizationId)} FOR SHARE OF p`);
    if (!problem) workflowError('PROBLEM_NOT_FOUND', 404);
    const adapter = this.registry.forProblem(problem);
    const context = { actor, problem, purpose };
    await adapter.authorizeRead(tx, context);
    return { problem, adapter, context };
  }

  async list(actor: WorkflowActor, query: ProblemIndexQueryDto): Promise<ProblemIndexPageResponseDto> {
    const checked = Object.assign(new ProblemIndexQueryDto(), query);
    if (validateSync(checked, { whitelist: true, forbidNonWhitelisted: true }).length || (query.dueFrom && query.dueTo && new Date(query.dueFrom) > new Date(query.dueTo))) throw new BadRequestException();
    const organizationId = query.organizationId ?? actor.organizationId;
    const conditions: Prisma.Sql[] = [this.scope(actor, organizationId, query.responseForm)];
    for (const [value, column] of [[query.domainCode, Prisma.sql`p.domain_code`], [query.problemType, Prisma.sql`p.problem_type`], [query.sourceType, Prisma.sql`p.source_type`], [query.status, Prisma.sql`p.status::text`], [query.severity, Prisma.sql`p.severity`]] as const) if (value !== undefined) conditions.push(Prisma.sql`${column} = ${value}`);
    if (query.ownerId) conditions.push(Prisma.sql`p.owner_id = ${query.ownerId}::uuid`);
    const pattern = searchPattern(query.search);
    if (pattern) conditions.push(Prisma.sql`p.report_number ILIKE ${pattern}`);
    if (query.dueFrom) conditions.push(Prisma.sql`p.due_at >= ${new Date(query.dueFrom)}`);
    if (query.dueTo) conditions.push(Prisma.sql`p.due_at <= ${new Date(query.dueTo)}`);
    if (query.overdueAt) conditions.push(Prisma.sql`p.due_at < ${new Date(query.overdueAt)} AND p.closed_at IS NULL AND p.archived_at IS NULL AND p.status NOT IN ('CLOSED', 'ARCHIVED')`);
    return this.prisma.$transaction(async (tx) => {
      await assertWorkflowFeature(tx, actor, organizationId, 'problem-index:read');
      const result = await readPage<ProblemIndex>(tx, Prisma.sql`SELECT ${columns} FROM problem_indexes p WHERE ${Prisma.join(conditions, ' AND ')}`, query);
      const grouped = new Map<ReturnType<ProblemDomainRegistry['forProblem']>, ProblemIndex[]>();
      for (const problem of result.items) {
        const adapter = this.registry.forProblem(problem);
        grouped.set(adapter, [...(grouped.get(adapter) ?? []), problem]);
      }
      const summaries = new Map<string, ProblemDomainSummary>();
      for (const [adapter, problems] of grouped) {
        const batch = await adapter.readSummaries(tx, actor, problems);
        for (const problem of problems) {
          const summary = batch.get(problem.id);
          if (!summary) throw new Error('PROBLEM_SUMMARY_UNAVAILABLE');
          summaries.set(problem.id, summary);
        }
      }
      await this.authenticate(tx, actor, organizationId);
      return { ...result, items: result.items.map((problem) => problemDto(problem, summaries.get(problem.id)!)) };
    }, { isolationLevel: 'ReadCommitted' });
  }

  async listProcessFollowup(actor: WorkflowActor, query: ProcessFollowupQueryDto): Promise<ProcessFollowupPageResponseDto> {
    const checked = Object.assign(new ProcessFollowupQueryDto(), query);
    if (validateSync(checked, { whitelist: true, forbidNonWhitelisted: true }).length || (query.dueFrom && query.dueTo && new Date(query.dueFrom) > new Date(query.dueTo))) throw new BadRequestException();
    const organizationId = query.organizationId ?? actor.organizationId;
    const { sql, predicate } = this.registry.followup('process-quality', 'process-defect', actor, organizationId);
    const conditions = [Prisma.sql`p.organization_id = ${organizationId}::uuid`, predicate];
    if (query.status) conditions.push(Prisma.sql`p.status::text = ${query.status}`);
    if (query.severity !== undefined) conditions.push(Prisma.sql`p.severity = ${query.severity}`);
    if (query.ownerId) conditions.push(Prisma.sql`p.owner_id = ${query.ownerId}::uuid`);
    if (query.stage) conditions.push(Prisma.sql`${sql.stage} = ${query.stage}`);
    if (query.responsibleSectionDepartmentId) conditions.push(Prisma.sql`${sql.sectionId} = ${query.responsibleSectionDepartmentId}::uuid`);
    for (const [column, value] of [[sql.sectionName, query.responsibleSectionName], [sql.ownerName, query.ownerName]] as const) {
      const name = searchPattern(value);
      if (name) conditions.push(Prisma.sql`${column} ILIKE ${name}`);
    }
    const pattern = searchPattern(query.search);
    if (pattern) conditions.push(Prisma.sql`(p.report_number ILIKE ${pattern} OR ${sql.search(pattern)})`);
    if (query.dueFrom) conditions.push(Prisma.sql`${sql.dueAt} >= ${new Date(query.dueFrom)}`);
    if (query.dueTo) conditions.push(Prisma.sql`${sql.dueAt} <= ${new Date(query.dueTo)}`);
    if (query.overdueAt) conditions.push(Prisma.sql`${sql.dueAt} < ${new Date(query.overdueAt)}`);
    return this.prisma.$transaction(async (tx) => {
      await this.authenticate(tx, actor, organizationId);
      await sql.authorize(tx);
      const result = await readPage<FollowupRow>(tx, Prisma.sql`
        SELECT ${indexColumns}, ${sql.dueAt} AS "dueAt", ${sql.stage} AS stage, ${sql.sectionId} AS "responsibleSectionDepartmentId", ${sql.projection}
        FROM problem_indexes p ${sql.joins} WHERE ${Prisma.join(conditions, ' AND ')}`, query);
      await this.authenticate(tx, actor, organizationId);
      await sql.authorize(tx);
      return { ...result, items: result.items.map((row) => ({ ...problemDto(row, sql.summarize(row)), stage: row.stage, responsibleSectionDepartmentId: row.responsibleSectionDepartmentId })) };
    }, { isolationLevel: 'ReadCommitted' });
  }

  async find(actor: WorkflowActor, organizationId: string, id: string): Promise<ProblemIndexResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const { problem, adapter } = await this.authorized(tx, actor, organizationId, id, 'overview');
      const summary = (await adapter.readSummaries(tx, actor, [problem])).get(problem.id);
      if (!summary) throw new Error('PROBLEM_SUMMARY_UNAVAILABLE');
      await this.authenticate(tx, actor, organizationId);
      return problemDto(problem, summary);
    }, { isolationLevel: 'ReadCommitted' });
  }

  private scope(actor: WorkflowActor, organizationId: string, responseForm?: ProblemIndexQueryDto['responseForm']): Prisma.Sql {
    return Prisma.sql`p.organization_id = ${organizationId}::uuid AND ${featurePredicate(Prisma.sql`${actor.id}::uuid`, Prisma.sql`p.organization_id`, Prisma.sql`'problem-index:read'`)} AND ${this.registry.visibility(actor, organizationId, responseForm)}`;
  }
}
