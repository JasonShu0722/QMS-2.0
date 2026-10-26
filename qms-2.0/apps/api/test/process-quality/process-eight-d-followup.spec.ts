import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { ProblemDomainRegistry } from '../../src/modules/problem-index/problem-domain-registry.js';
import { ProcessEightDReadAdapter } from '../../src/modules/process-quality/process-eight-d-read.adapter.js';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import type { ProcessEightDActor, ProcessEightDRecord } from '../../src/modules/process-quality/process-eight-d.types.js';

const organizationId = randomUUID(), ownerId = randomUUID(), sectionId = randomUUID();
const actor: ProcessEightDActor = { id: randomUUID(), organizationId, accountType: 'INTERNAL', sessionId: randomUUID() };
const due = new Date('2026-11-01T08:00:00+08:00');
function record(): ProcessEightDRecord {
  return {
    problem: { id: randomUUID(), organizationId, reportNumber: '8D-001', domainCode: 'process-quality', sourceType: 'process-defect',
      problemType: 'PROCESS_DEFECT', status: 'IN_PROGRESS', ownerId, closedAt: null, archivedAt: null },
    instance: { id: randomUUID(), organizationId, status: 'RUNNING' }, node: { config: {} }, collaboratorUserIds: [],
    report: { responsibleSectionDepartmentId: sectionId, document: { ...emptyProcessEightDDocument(), description: 'Authorized description' },
      analysisDueAt: due, submissionDueAt: null, closureDueAt: due, analysisCompletedAt: null, submittedAt: null, closedRevisionId: null },
  } as unknown as ProcessEightDRecord;
}
function setup(records = [record()]) {
  const calls: string[] = [], queries: Prisma.Sql[] = [];
  let approved: unknown = { description: 'Approved description', ownerId, sectionId, analysisDueAt: due.toISOString(), submissionDueAt: null,
    closureDueAt: due.toISOString(), analysisCompletedAt: due.toISOString(), submittedAt: due.toISOString() };
  const names = [{ kind: 'owner', id: ownerId, name: 'Owner Name' }, { kind: 'section', id: sectionId, name: 'Section Name' }];
  const tx = { $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
    queries.push(sql); calls.push('query');
    if (sql.sql.includes('process_eight_d_revisions')) return approved ? [approved] : [];
    expect(calls.filter(c => c === 'authorize')).toHaveLength(records.length);
    return names;
  }) };
  const service = {
    hasReport: jest.fn(async (_tx: unknown, _organizationId: string, id: string) => records.some(r => r.problem.id === id)),
    lockRecord: jest.fn(async (_tx: unknown, _actor: unknown, id: string) => { calls.push('lock'); return records.find(r => r.problem.id === id)!; }),
    authorizeRead: jest.fn(async () => { calls.push('authorize'); }),
    readReport: jest.fn(async () => { calls.push('full-report'); return { record: records[0] }; }),
  };
  const adapter = new ProcessEightDReadAdapter(new ProblemDomainRegistry([]), service as never);
  const read = () => adapter.readSummaries(tx as never, actor, records.map(r => ({ ...r.problem, reportNumber: 'Stale title' })));
  return { records, calls, queries, tx, service, read, names, setApproved: (value: unknown) => { approved = value; } };
}
const values = (summary: { fields?: { key: string; value: string | null }[] } | undefined) => Object.fromEntries(summary?.fields?.map(f => [f.key, f.value]) ?? []);

it('uses authorized locked facts, batched names and ISO dates without reading any full snapshot', async () => {
  const s = setup([record(), record()]);
  const result = await s.read();
  expect(result.get(s.records[0]!.problem.id)).toMatchObject({ title: '8D-001', description: 'Authorized description', domainUiKey: 'process-eight-d' });
  expect(values(result.get(s.records[0]!.problem.id))).toEqual({ responsibleSectionName: 'Section Name', ownerName: 'Owner Name', stage: '分析阶段',
    analysisDueAt: '2026-11-01T00:00:00.000Z', submissionDueAt: null, closureDueAt: '2026-11-01T00:00:00.000Z', analysisCompletedAt: null, submittedAt: null });
  expect(s.service.readReport).not.toHaveBeenCalled();
  expect(s.service.lockRecord).toHaveBeenCalledTimes(2);
  expect(s.service.lockRecord).toHaveBeenCalledWith(s.tx, actor, s.records[0]!.problem.id, 'READ');
  expect(s.service.authorizeRead).toHaveBeenCalledWith(s.tx, actor, s.records[0]);
  expect(s.queries).toHaveLength(1);
  const sql = s.queries[0]!;
  expect(sql.sql).toMatch(/full_name/);
  expect(sql.sql).toMatch(/username/);
  expect(sql.sql).not.toMatch(/SELECT\s+\*/i);
  expect(sql.sql.match(/organization_id/g)).toHaveLength(2);
  expect(sql.values.filter(v => v === ownerId)).toHaveLength(1);
  expect(sql.values.filter(v => v === sectionId)).toHaveLength(1);
  expect(sql.values.filter(v => v === organizationId)).toHaveLength(2);
});

it('fails authorization before querying names or closed snapshots', async () => {
  const s = setup();
  s.records[0]!.report.closedRevisionId = randomUUID();
  s.service.authorizeRead.mockImplementation(async () => { throw new HttpException('denied', 403); });
  await expect(s.read()).rejects.toMatchObject({ status: 403 });
  expect(s.tx.$queryRaw).not.toHaveBeenCalled();
  expect(s.service.readReport).not.toHaveBeenCalled();
});

it.each([
  ['analysis', '分析阶段'], ['submission', '完整提交阶段'], ['closure', '关闭阶段'], ['review', '关闭审批中'],
  ['closed', '已关闭'], ['archived', '已归档'], ['cancelled', '已取消'], ['suspended', '已暂停'], ['failed', '流程失败'], ['completed', '流程已结束'],
])('derives %s stage from authoritative status, workflow and milestones', async (state, stage) => {
  const s = setup(), r = s.records[0]!;
  if (['submission', 'closure'].includes(state)) r.report.analysisCompletedAt = due;
  if (state === 'closure') r.report.submittedAt = due;
  if (state === 'review') r.node.config = { closureReview: {} };
  if (state === 'closed') { r.problem.status = 'CLOSED'; r.problem.closedAt = due; }
  if (state === 'archived') r.problem.status = 'ARCHIVED';
  if (['cancelled', 'suspended', 'failed', 'completed'].includes(state)) {
    r.instance.status = state.toUpperCase() as typeof r.instance.status;
    r.node.config = { closureReview: {} };
  }
  expect(values((await s.read()).get(r.problem.id)).stage).toBe(stage);
});

it('projects only the pinned closed revision and never substitutes current mutable facts', async () => {
  const s = setup(), r = s.records[0]!;
  const frozenOwner = randomUUID(), frozenSection = randomUUID();
  r.report.closedRevisionId = randomUUID(); r.problem.status = 'ARCHIVED';
  s.setApproved({ description: 'Approved description', ownerId: frozenOwner, sectionId: frozenSection,
    analysisDueAt: null, submissionDueAt: due.toISOString(), closureDueAt: null, analysisCompletedAt: null, submittedAt: null });
  s.names.splice(0, s.names.length, { kind: 'owner', id: frozenOwner, name: 'Frozen Owner' }, { kind: 'section', id: frozenSection, name: 'Frozen Section' });
  const summary = (await s.read()).get(r.problem.id)!;
  expect(summary.description).toBe('Approved description');
  expect(values(summary)).toMatchObject({ ownerName: 'Frozen Owner', responsibleSectionName: 'Frozen Section', stage: '已归档',
    analysisDueAt: null, submissionDueAt: due.toISOString(), closureDueAt: null });
  expect(s.queries).toHaveLength(2);
  expect(s.queries[0]!.values).toEqual(expect.arrayContaining([organizationId, r.problem.id, r.report.closedRevisionId]));
  expect(s.queries[0]!.sql).not.toMatch(/SELECT\s+(?:\*|snapshot\s*(?:,|FROM))/i);
  expect(s.queries[1]!.values).toEqual(expect.arrayContaining([frozenOwner, frozenSection]));
  expect(s.queries[1]!.values).not.toContain(ownerId);
  expect(s.queries[1]!.values).not.toContain(sectionId);
  expect(s.service.readReport).not.toHaveBeenCalled();
});

it('fails closed projection when the pinned revision is missing instead of using current facts', async () => {
  const s = setup(); s.records[0]!.report.closedRevisionId = randomUUID(); s.setApproved(null);
  await expect(s.read()).rejects.toMatchObject({ status: 404 });
  expect(s.queries).toHaveLength(1);
});

it('returns null names for missing authorized references, never UUIDs', async () => {
  const s = setup(); s.names.length = 0;
  expect(values((await s.read()).get(s.records[0]!.problem.id))).toMatchObject({ ownerName: null, responsibleSectionName: null });
});

it('leaves legacy summaries unchanged and performs no name query for them or an empty page', async () => {
  const s = setup(); s.service.hasReport.mockResolvedValue(false);
  expect((await s.read()).get(s.records[0]!.problem.id)).toEqual({ title: 'Stale title', description: '过程质量 · PROCESS_DEFECT', domainUiKey: 'process-quality' });
  expect(s.tx.$queryRaw).not.toHaveBeenCalled(); expect(s.service.lockRecord).not.toHaveBeenCalled();
  expect(await setup([]).read()).toEqual(new Map());
});
