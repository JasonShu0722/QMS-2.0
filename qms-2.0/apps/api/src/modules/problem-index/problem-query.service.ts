import { BadRequestException, Injectable } from '@nestjs/common';
import { validateSync, isUUID } from 'class-validator';
import { Prisma, type ProblemIndex } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { assertWorkflowFeature, featurePredicate, type WorkflowActor } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import { ProblemDomainRegistry, type ProblemDomainSummary, type ProblemReadPurpose } from './problem-domain-registry.js';
import { ProblemIndexQueryDto, type ProblemIndexPageResponseDto, type ProblemIndexResponseDto, type ProblemStatusCountDto } from './problem-index.dto.js';
import { summaryProjection } from './problem-domain-projection.js';

const columns = Prisma.sql`p.id, p.organization_id AS "organizationId", p.report_number AS "reportNumber", p.domain_code AS "domainCode", p.problem_type AS "problemType", p.source_type AS "sourceType", p.source_id AS "sourceId", p.status, p.severity, p.responsible_party AS "responsibleParty", p.owner_id AS "ownerId", p.due_at AS "dueAt", p.workflow_instance_id AS "workflowInstanceId", p.closed_at AS "closedAt", p.archived_at AS "archivedAt", p.version, p.created_by_id AS "createdById", p.updated_by_id AS "updatedById", p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;
const ordering = { createdAt: Prisma.sql`"createdAt"`, updatedAt: Prisma.sql`"updatedAt"`, dueAt: Prisma.sql`"dueAt"`, reportNumber: Prisma.sql`"reportNumber"`, status: Prisma.sql`status`, severity: Prisma.sql`severity` };

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
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const conditions: Prisma.Sql[] = [this.scope(actor, organizationId)];
    for (const [value, column] of [[query.domainCode, Prisma.sql`p.domain_code`], [query.problemType, Prisma.sql`p.problem_type`], [query.status, Prisma.sql`p.status::text`], [query.severity, Prisma.sql`p.severity`]] as const) if (value !== undefined) conditions.push(Prisma.sql`${column} = ${value}`);
    if (query.ownerId) conditions.push(Prisma.sql`p.owner_id = ${query.ownerId}::uuid`);
    if (query.search?.trim()) conditions.push(Prisma.sql`p.report_number ILIKE ${`%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`}`);
    if (query.dueFrom) conditions.push(Prisma.sql`p.due_at >= ${new Date(query.dueFrom)}`);
    if (query.dueTo) conditions.push(Prisma.sql`p.due_at <= ${new Date(query.dueTo)}`);
    if (query.overdueAt) conditions.push(Prisma.sql`p.due_at < ${new Date(query.overdueAt)} AND p.closed_at IS NULL AND p.archived_at IS NULL AND p.status NOT IN ('CLOSED', 'ARCHIVED')`);
    const direction = query.sortDirection === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const order = Prisma.sql`${ordering[query.sortBy ?? 'createdAt']} ${direction} NULLS LAST, id ${direction}`;
    return this.prisma.$transaction(async (tx) => {
      await assertWorkflowFeature(tx, actor, organizationId, 'problem-index:read');
      const [result] = await tx.$queryRaw<{ total: number; items: ProblemIndex[]; statusCounts: ProblemStatusCountDto[] }[]>(Prisma.sql`
        WITH eligible AS MATERIALIZED (SELECT ${columns} FROM problem_indexes p WHERE ${Prisma.join(conditions, ' AND ')}),
        selected AS (SELECT * FROM eligible ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}),
        counts AS (SELECT status, count(*)::int AS count FROM eligible GROUP BY status)
        SELECT (SELECT count(*)::int FROM eligible) AS total,
          COALESCE((SELECT jsonb_agg(selected ORDER BY ${order}) FROM selected), '[]'::jsonb) AS items,
          COALESCE((SELECT jsonb_agg(counts ORDER BY status) FROM counts), '[]'::jsonb) AS "statusCounts"`);
      const grouped = new Map<ReturnType<ProblemDomainRegistry['forProblem']>, ProblemIndex[]>();
      for (const problem of result!.items) {
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
      return { items: result!.items.map((problem) => problemDto(problem, summaries.get(problem.id)!)), total: result!.total, statusCounts: result!.statusCounts, page, pageSize };
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

  private scope(actor: WorkflowActor, organizationId: string): Prisma.Sql {
    return Prisma.sql`p.organization_id = ${organizationId}::uuid AND ${featurePredicate(Prisma.sql`${actor.id}::uuid`, Prisma.sql`p.organization_id`, Prisma.sql`'problem-index:read'`)} AND ${this.registry.visibility(actor, organizationId)}`;
  }
}
