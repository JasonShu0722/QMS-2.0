import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { INTERNAL_EIGHT_D_DOMAINS as domains } from '../../src/common/eight-d/internal-eight-d-domain.js';
import { readProcessEightDFollowupSummaries } from '../../src/modules/process-quality/process-eight-d-followup.read-model.js';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import type { ProcessEightDRecord } from '../../src/modules/process-quality/process-eight-d.types.js';

function fixture() {
  const organizationId = randomUUID(), ownerId = randomUUID(), sectionId = randomUUID(), revisionId = randomUUID();
  const record = { problem: { organizationId, id: randomUUID(), reportNumber: '8D-001', status: 'CLOSED', ownerId },
    report: { document: emptyProcessEightDDocument(), closedRevisionId: revisionId }, instance: { status: 'COMPLETED' }, node: { config: {} },
  } as ProcessEightDRecord;
  const facts = { description: 'Pinned description', ownerId, sectionId, analysisDueAt: null, submissionDueAt: null, closureDueAt: null,
    analysisCompletedAt: null, submittedAt: null };
  const tx = { $queryRaw: jest.fn(async (sql: Prisma.Sql) => sql.sql.includes('_revisions') ? [facts] : [
    { kind: 'owner', id: ownerId, name: 'Owner' }, { kind: 'section', id: sectionId, name: 'Section' },
  ]) };
  return { record, facts, tx, organizationId, ownerId, sectionId, revisionId };
}

it.each(Object.values(domains))('reads only bounded pinned fields and names from $storagePrefix', async domain => {
  const f = fixture();
  const result = await readProcessEightDFollowupSummaries(f.tx as never, [f.record], domain);
  expect(result.get(f.record.problem.id)).toMatchObject({ description: 'Pinned description', domainUiKey: domain.resourceType });
  expect(result.get(f.record.problem.id)?.fields).toHaveLength(8);
  expect(f.tx.$queryRaw).toHaveBeenCalledTimes(2);
  const [revision, names] = f.tx.$queryRaw.mock.calls.map(([sql]: [Prisma.Sql]) => sql);
  expect(revision!.sql).toContain(`FROM ${domain.storagePrefix}_revisions`);
  for (const other of Object.values(domains).filter(d => d !== domain)) expect(revision!.sql).not.toContain(`${other.storagePrefix}_revisions`);
  expect(revision!.values).toEqual([f.organizationId, f.record.problem.id, f.revisionId]);
  expect(revision!.sql).not.toMatch(/SELECT\s+(?:\*|snapshot\s*(?:,|FROM))/i);
  expect(revision!.sql).not.toMatch(/source|evidence|approval|round/i);
  expect(names!.values).toEqual([f.organizationId, f.ownerId, f.organizationId, f.sectionId]);
  expect(names!.sql).not.toMatch(/SELECT\s+\*/i);
});

it('keeps the default PROCESS table/UI contract unchanged', async () => {
  const f = fixture();
  expect((await readProcessEightDFollowupSummaries(f.tx as never, [f.record])).get(f.record.problem.id)?.domainUiKey).toBe('process-eight-d');
  expect(f.tx.$queryRaw.mock.calls[0]![0].sql).toContain('FROM process_eight_d_revisions');
});

it('rejects an unapproved descriptor even on an empty page without querying', async () => {
  const f = fixture();
  await expect(readProcessEightDFollowupSummaries(f.tx as never, [], { ...domains.PROCESS } as never)).rejects.toThrow('INTERNAL_EIGHT_D_DOMAIN_INVALID');
  expect(f.tx.$queryRaw).not.toHaveBeenCalled();
});

it('fails a missing pinned domain revision rather than falling back to mutable or another domain facts', async () => {
  const f = fixture(); f.tx.$queryRaw.mockResolvedValueOnce([]);
  await expect(readProcessEightDFollowupSummaries(f.tx as never, [f.record], domains.CUSTOMER)).rejects.toMatchObject({ status: 404 });
  expect(f.tx.$queryRaw).toHaveBeenCalledTimes(1);
});
