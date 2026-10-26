import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { validateSync } from 'class-validator';
import { Prisma } from '../../src/generated/prisma/client.js';
import { ProblemIndexQueryDto } from '../../src/modules/problem-index/problem-index.dto.js';
import { ProblemDomainRegistry } from '../../src/modules/problem-index/problem-domain-registry.js';
import { DomainProblemReadAdapter } from '../../src/modules/problem-index/domain-problem-read.adapter.js';
import { sectionProjection, summaryProjection } from '../../src/modules/problem-index/problem-domain-projection.js';
import type { ProblemDomainSummary } from '../../src/modules/problem-index/problem-domain-registry.js';

const summary = { title: '8D-001', description: 'Description', domainUiKey: 'process-eight-d' };
const field = { key: 'ownerName', label: 'Owner', value: 'Name' };
const project = (fields: unknown) => summaryProjection({ ...summary, fields } as ProblemDomainSummary);

it('preserves optional bounded summary fields and strips unregistered properties', () => {
  expect(project([{ ...field, secret: 'hidden' }, { key: 'analysisDueAt', label: 'Due', value: null }])).toEqual({
    ...summary, fields: [field, { key: 'analysisDueAt', label: 'Due', value: null }],
  });
  expect(summaryProjection(summary)).toEqual(summary);
  expect(project([])).toEqual({ ...summary, fields: [] });
});

it('accepts the same exact field limits as sections', () => {
  const fields = Array.from({ length: 50 }, (_, index) => ({ key: `F${index}`.padEnd(100, 'x'), label: 'x'.repeat(200), value: 'x'.repeat(20000) }));
  expect(project(fields)).toEqual({ ...summary, fields });
  expect(sectionProjection([{ key: 'section', title: 'Section', fields }])[0]!.fields).toEqual(fields);
});

it.each([
  null, {}, 'fields', [field, field], Array.from({ length: 51 }, (_, i) => ({ ...field, key: `F${i}` })),
  [{ ...field, key: 'not a key' }], [{ ...field, key: 'x'.repeat(101) }],
  [{ ...field, label: 'x'.repeat(201) }], [{ ...field, value: 'x'.repeat(20001) }],
  [{ ...field, value: 42 }], [{ ...field, value: undefined }], [null],
])('rejects invalid summary fields at the projection boundary: %p', fields => {
  expect(() => project(fields)).toThrow('PROBLEM_DOMAIN_RESPONSE_INVALID');
});

it.each(['BRIEF', 'EIGHT_D'])('validates the optional exact response form %s without adding a persisted field', responseForm => {
  expect(validateSync(Object.assign(new ProblemIndexQueryDto(), { responseForm }), { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
});

it('rejects unknown response form values and preserves unfiltered queries', () => {
  expect(validateSync(new ProblemIndexQueryDto(), { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  expect(validateSync(Object.assign(new ProblemIndexQueryDto(), { responseForm: 'BPMN' }), { whitelist: true, forbidNonWhitelisted: true }).length).toBeGreaterThan(0);
});

it('fails closed for unsupported form adapters and ANDs supported form facts with existing visibility', () => {
  const actor = { id: randomUUID(), organizationId: randomUUID(), accountType: 'INTERNAL', sessionId: randomUUID() } as const;
  const legacy = new DomainProblemReadAdapter({ domainCode: 'legacy', sourceType: 'source', permission: 'legacy:read', label: 'Legacy' });
  const unfiltered = new ProblemDomainRegistry([legacy]).visibility(actor, actor.organizationId);
  expect(unfiltered.sql).not.toContain('FALSE');
  expect(new ProblemDomainRegistry([legacy]).visibility(actor, actor.organizationId, 'EIGHT_D').sql).toContain('FALSE');
  const supported = Object.assign(legacy, { responseFormPredicate: (form: string) => Prisma.sql`p.source_type = ${form}` });
  const filtered = new ProblemDomainRegistry([supported]).visibility(actor, actor.organizationId, 'EIGHT_D');
  expect(filtered.values).toEqual(expect.arrayContaining(['legacy:read', 'EIGHT_D']));
  expect(filtered.sql).toMatch(/AND/);
});
