import { Prisma } from '../../generated/prisma/client.js';
import { INTERNAL_EIGHT_D_DOMAINS, internalEightDSql, type InternalEightDDomainDescriptor } from '../../common/eight-d/internal-eight-d-domain.js';
import type { ProblemDomainSummary } from '../problem-index/problem-domain-registry.js';
import { isClosureReviewNode } from '../workflow/workflow-runtime-policy.js';
import { eightDError } from './process-eight-d-policy.js';
import type { ProcessEightDRecord } from './process-eight-d.types.js';

type FollowupFacts = {
  description: string; ownerId: string | null; sectionId: string;
  analysisDueAt: string | null; submissionDueAt: string | null; closureDueAt: string | null;
  analysisCompletedAt: string | null; submittedAt: string | null;
};
type NameRow = { kind: 'owner' | 'section'; id: string; name: string };
const iso = (date: Date | null) => date?.toISOString() ?? null;

function stage(record: ProcessEightDRecord, facts: FollowupFacts): string {
  if (record.problem.status === 'ARCHIVED' || record.problem.archivedAt) return '已归档';
  if (record.report.closedRevisionId || record.problem.closedAt || record.problem.status === 'CLOSED') return '已关闭';
  if (record.instance.status === 'CANCELLED') return '已取消';
  if (record.instance.status === 'SUSPENDED') return '已暂停';
  if (record.instance.status === 'FAILED') return '流程失败';
  if (record.instance.status === 'COMPLETED') return '流程已结束';
  if (isClosureReviewNode(record.node)) return '关闭审批中';
  if (facts.submittedAt) return '关闭阶段';
  return facts.analysisCompletedAt ? '完整提交阶段' : '分析阶段';
}

// Only already-authorized page records enter this read model; no directory or management permission is exposed.
export async function readProcessEightDFollowupSummaries(tx: Prisma.TransactionClient, records: readonly ProcessEightDRecord[], domain: InternalEightDDomainDescriptor = INTERNAL_EIGHT_D_DOMAINS.PROCESS): Promise<ReadonlyMap<string, ProblemDomainSummary>> {
  const tables = internalEightDSql(domain);
  const facts = new Map<string, FollowupFacts>();
  const organizations = new Map<string, ProcessEightDRecord[]>();
  for (const record of records) {
    const { problem, report } = record;
    let selected: FollowupFacts;
    if (report.closedRevisionId) {
      // Extract only list fields from the pinned revision, never sources, evidence or approval-round history.
      const [snapshot] = await tx.$queryRaw<FollowupFacts[]>(Prisma.sql`SELECT
        snapshot #>> '{document,description}' AS description, snapshot ->> 'ownerUserId' AS "ownerId",
        snapshot ->> 'responsibleSectionDepartmentId' AS "sectionId",
        snapshot #>> '{deadlines,analysisDueAt}' AS "analysisDueAt", snapshot #>> '{deadlines,submissionDueAt}' AS "submissionDueAt",
        snapshot #>> '{deadlines,closureDueAt}' AS "closureDueAt", snapshot ->> 'analysisCompletedAt' AS "analysisCompletedAt",
        snapshot ->> 'submittedAt' AS "submittedAt"
        FROM ${tables.revisions} WHERE organization_id = ${problem.organizationId}::uuid
          AND problem_id = ${problem.id}::uuid AND id = ${report.closedRevisionId}::uuid`);
      if (!snapshot) eightDError('PROBLEM_REPORT_REVISION_NOT_FOUND', 404);
      selected = snapshot;
    } else {
      selected = { description: report.document.description, ownerId: problem.ownerId, sectionId: report.responsibleSectionDepartmentId,
        analysisDueAt: iso(report.analysisDueAt), submissionDueAt: iso(report.submissionDueAt), closureDueAt: iso(report.closureDueAt),
        analysisCompletedAt: iso(report.analysisCompletedAt), submittedAt: iso(report.submittedAt) };
    }
    facts.set(problem.id, selected);
    const group = organizations.get(problem.organizationId) ?? [];
    group.push(record); organizations.set(problem.organizationId, group);
  }

  const summaries = new Map<string, ProblemDomainSummary>();
  for (const [organizationId, group] of organizations) {
    const ownerIds = [...new Set(group.map(r => facts.get(r.problem.id)!.ownerId).filter((id): id is string => id !== null))];
    const sectionIds = [...new Set(group.map(r => facts.get(r.problem.id)!.sectionId))];
    const names = await tx.$queryRaw<NameRow[]>(Prisma.sql`
      SELECT 'owner' AS kind, id, COALESCE(NULLIF(BTRIM(full_name), ''), username) AS name FROM users
        WHERE organization_id = ${organizationId}::uuid AND ${ownerIds.length ? Prisma.sql`id IN (${Prisma.join(ownerIds.map(id => Prisma.sql`${id}::uuid`))})` : Prisma.sql`FALSE`}
      UNION ALL SELECT 'section' AS kind, id, name FROM departments
        WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(sectionIds.map(id => Prisma.sql`${id}::uuid`))})`);
    const owners = new Map(names.filter(n => n.kind === 'owner').map(n => [n.id, n.name]));
    const sections = new Map(names.filter(n => n.kind === 'section').map(n => [n.id, n.name]));
    for (const record of group) {
      const selected = facts.get(record.problem.id)!;
      summaries.set(record.problem.id, { title: record.problem.reportNumber, description: selected.description, domainUiKey: domain.resourceType, fields: [
        { key: 'responsibleSectionName', label: '责任科室', value: sections.get(selected.sectionId) ?? null },
        { key: 'ownerName', label: '负责人', value: selected.ownerId ? owners.get(selected.ownerId) ?? null : null },
        { key: 'stage', label: '当前阶段', value: stage(record, selected) },
        { key: 'analysisDueAt', label: '分析期限', value: selected.analysisDueAt },
        { key: 'submissionDueAt', label: '完整提交期限', value: selected.submissionDueAt },
        { key: 'closureDueAt', label: '关闭期限', value: selected.closureDueAt },
        { key: 'analysisCompletedAt', label: '分析完成时间', value: selected.analysisCompletedAt },
        { key: 'submittedAt', label: '完整提交时间', value: selected.submittedAt },
      ] });
    }
  }
  return summaries;
}
