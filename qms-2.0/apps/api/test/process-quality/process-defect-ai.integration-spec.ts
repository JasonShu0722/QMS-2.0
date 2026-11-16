import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { processIngestionFixture, type ProcessIngestionFixture } from './process-defect-ingestion.fixture.js';

describe('AI description persistent source and adoption using PostgreSQL', () => {
  let fixture: ProcessIngestionFixture;
  beforeAll(async () => { fixture = await processIngestionFixture(); });
  afterAll(async () => { await fixture?.prisma.$disconnect(); });

  it('persists the direct fallback on the initial IMS insert', async () => {
    const created = await fixture.ingest(fixture.fields({ description: '现象：毛刺；位置：端面', externalRecordKey: randomUUID() }));
    const row = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toHaveProperty('descriptionDirect', '现象：毛刺；位置：端面');
    expect(row).toHaveProperty('descriptionSource', 'DIRECT');
  });

  it('records a new input revision and applies a valid AI result without losing project facts', async () => {
    expect(fixture.adapter).toHaveProperty('prepareAiDescription');
    expect(fixture.adapter).toHaveProperty('applyAiDescription');
    const created = await fixture.ingest(fixture.fields({ rowIndex: 1, description: '直接事实', externalRecordKey: randomUUID() }));
    const adapter = fixture.adapter;
    const { revision } = await fixture.prisma.$transaction(tx => adapter.prepareAiDescription(tx, fixture.actor, created.id, randomUUID(), [{ path: 'a', label: '', value: '直接事实' }], '直接事实'));
    await fixture.prisma.processDefect.update({ where: { id: created.id }, data: { version: { increment: 1 }, registrationIssues: ['description:INVALID', 'TRACE_CODE_REQUIRED'], pendingCompletion: true } });
    const result = await fixture.prisma.$transaction(tx => adapter.applyAiDescription(tx, fixture.actor, created.id, revision, '直接事实', '整理事实', randomUUID()));
    expect(result).toBe('APPLIED');
    const row = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.description).toBe('整理事实');
    expect(row.registrationIssues).toContain('TRACE_CODE_REQUIRED');
    expect(row.registrationIssues).not.toContain('description:INVALID');
    expect(row.pendingCompletion).toBe(true);
  });

  it('stores late AI as a suggestion after a human edit and rejects a stale source revision', async () => {
    expect(fixture.adapter).toHaveProperty('prepareAiDescription');
    const adapter = fixture.adapter;
    const created = await fixture.ingest(fixture.fields({ rowIndex: 2, description: '直接事实', externalRecordKey: randomUUID() }));
    const { revision } = await fixture.prisma.$transaction(tx => adapter.prepareAiDescription(tx, fixture.actor, created.id, randomUUID(), [{ path: 'a', label: '', value: '直接事实' }], '直接事实'));
    await fixture.prisma.processDefect.update({ where: { id: created.id }, data: { description: '人工描述', manualFields: ['description'] } });
    expect(await fixture.prisma.$transaction(tx => adapter.applyAiDescription(tx, fixture.actor, created.id, revision, '直接事实', '迟到结果', randomUUID()))).toBe('SUGGESTED');
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: created.id } })).description).toBe('人工描述');
    const next = await fixture.prisma.$transaction(tx => adapter.prepareAiDescription(tx, fixture.actor, created.id, randomUUID(), [{ path: 'a', label: '', value: '新事实' }], '新事实'));
    expect(next.revision).toBeGreaterThan(revision);
    expect(await fixture.prisma.$transaction(tx => adapter.applyAiDescription(tx, fixture.actor, created.id, revision, '直接事实', '旧响应', randomUUID()))).toBe('STALE');
  });
});
