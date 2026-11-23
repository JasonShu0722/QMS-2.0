import { randomUUID } from 'node:crypto';
import { processIngestionFixture, type ProcessIngestionFixture } from './process-defect-ingestion.fixture.js';

describe('IMS process defects in the real PostgreSQL ledger', () => {
  let fixture: ProcessIngestionFixture;
  beforeEach(async () => { fixture = await processIngestionFixture(); });
  afterEach(async () => { await fixture?.prisma.$disconnect(); });

  it('persists every normalized partial object with quantity one and real source identity', async () => {
    const first = await fixture.ingest(fixture.fields({ productCode: '000017', lineName: '名称一线', issues: ['occurredAt:INVALID'] }));
    const second = await fixture.ingest(fixture.fields({ rowIndex: 1, traceCode: 'TRACE' }));
    expect(second.id).not.toBe(first.id);
    const row = await fixture.ledger.detail(fixture.actor, first.id);
    expect(row).toMatchObject({ sourceKind: 'IMS', createdById: fixture.actor.id, registeredByName: '自动', defectQuantity: 1,
      productCode: '000017', lineName: '名称一线', lineCode: null, occurredAt: null, shift: null, pendingCompletion: true, pendingConfiguration: true });
    expect(row.registrationIssues).toEqual(expect.arrayContaining(['occurredAt:INVALID', 'OCCURRED_AT_REQUIRED', 'TRACE_CODE_REQUIRED', 'DESCRIPTION_REQUIRED']));
    expect(await fixture.prisma.processDefect.count({ where: { organizationId: fixture.actor.organizationId } })).toBe(2);
  });

  it('writes explicit null, replaces factory issues and preserves them on unmapped updates', async () => {
    const input = fixture.fields({ description: '来源事实', factoryCode: 'FACTORY_1', issues: ['lineName:TYPE'] });
    const first = await fixture.ingest(input);
    const invalid = await fixture.ingest({ ...input, factoryCode: null, issues: ['factory:INVALID'] });
    expect(invalid).toMatchObject({ version: first.version + 1, values: { factoryCode: null } });
    const empty = await fixture.ingest({ ...input, factoryCode: null, issues: ['factory:EMPTY'] });
    expect(empty).toMatchObject({ version: invalid.version + 1, values: { factoryCode: null } });
    expect(empty.values.issues).toContain('factory:EMPTY');
    expect(empty.values.issues).not.toContain('factory:INVALID');
    const replay = await fixture.ingest({ ...input, factoryCode: null, issues: ['factory:EMPTY'] });
    expect(replay.version).toBe(empty.version);
    const unmapped = await fixture.ingest(fixture.fields({ description: '旧规则更新' }));
    expect(unmapped.values.issues).toContain('factory:EMPTY');
    const restored = await fixture.ingest(fixture.fields({ factoryCode: 'FACTORY_2' }));
    expect(restored).toMatchObject({ version: unmapped.version + 1, values: { factoryCode: 'FACTORY_2' } });
    const row = await fixture.ledger.detail(fixture.actor, first.id);
    expect(row).toMatchObject({ factoryCode: 'FACTORY_2', pendingCompletion: true });
    expect(row.registrationIssues.filter(issue => issue.includes(':'))).toEqual(['lineName:TYPE']);
    const updates = await fixture.prisma.auditEvent.findMany({ where: { resourceId: first.id, action: 'PROCESS_DEFECT_INGESTION_UPDATED' } });
    expect(updates.map(event => event.metadata)).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceVersion: invalid.version, changedFields: 'factoryCode' }),
      expect.objectContaining({ resourceVersion: empty.version, changedFields: 'factoryCode' }),
      expect.objectContaining({ resourceVersion: restored.version, changedFields: 'factoryCode' }),
    ]));
    expect(updates.map(event => event.metadata).find(metadata => (metadata as { resourceVersion?: number }).resourceVersion === unmapped.version)).not.toHaveProperty('changedFields');
  });

  it('reuses a receipt row and a numbered identity but does not merge different unnumbered messages', async () => {
    const input = fixture.fields({ description: '初次' });
    const first = await fixture.ingest(input), replay = await fixture.ingest(input);
    expect(replay).toMatchObject({ id: first.id, version: first.version });
    const anotherReceipt = await fixture.receipt();
    const second = await fixture.ingest({ ...input, receiptId: anotherReceipt.id });
    expect(second.id).not.toBe(first.id);
    const numbered = await fixture.ingest(fixture.fields({ rowIndex: 2, externalRecordKey: '000009', traceCode: 'SAME' }));
    const again = await fixture.ingest({ ...fixture.fields({ rowIndex: 3, externalRecordKey: '000009', traceCode: 'SAME' }), receiptId: anotherReceipt.id });
    expect(again.id).toBe(numbered.id);
  });

  it('allows partial human completion without changing the source and protects it until explicit confirmation', async () => {
    const created = await fixture.ingest(fixture.fields());
    const partial = await fixture.ledger.update(fixture.actor, created.id, { expectedVersion: created.version, traceCode: '人工扫码' }, randomUUID(), randomUUID());
    expect(partial).toMatchObject({ sourceKind: 'IMS', traceCode: '人工扫码', occurredAt: null, pendingCompletion: true });
    const restored = await fixture.ledger.update(fixture.actor, created.id, { expectedVersion: partial.version, occurredAt: new Date('2026-11-16T12:30:00Z') }, randomUUID(), randomUUID());
    expect(restored.shift).toBe('NIGHT');
    const conflict = fixture.fields({ traceCode: '后台不同值' });
    await expect(fixture.ingest(conflict)).rejects.toMatchObject({ status: 409, response: { code: 'PROCESS_DEFECT_MANUAL_CONFIRMATION_REQUIRED' } });
    const confirmed = await fixture.ingest(conflict, true);
    expect(confirmed.values.traceCode).toBe('后台不同值');
    const history = await fixture.prisma.$queryRaw<{ actor_user_id: string | null; action: string }[]>`SELECT actor_user_id, action FROM process_defect_registration_history WHERE defect_id = ${created.id}::uuid ORDER BY defect_version`;
    expect(history.map(item => item.action)).toEqual(['IMS_CREATED', 'MANUAL_UPDATED', 'MANUAL_UPDATED', 'IMS_UPDATED']);
    expect(history.every(item => item.actor_user_id === fixture.actor.id)).toBe(true);
  });

  it('reports a later source number collision without deleting or merging either record', async () => {
    const anonymous = await fixture.ingest(fixture.fields());
    const numbered = await fixture.ingest(fixture.fields({ rowIndex: 1, externalRecordKey: 'ID-1' }));
    await expect(fixture.ledger.update(fixture.actor, anonymous.id, { expectedVersion: anonymous.version, externalRecordKey: 'ID-1' }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 409, response: { code: 'PROCESS_DEFECT_EXTERNAL_IDENTITY_CONFLICT' } });
    expect(await fixture.prisma.processDefect.count({ where: { id: { in: [anonymous.id, numbered.id] } } })).toBe(2);
    const changed = await fixture.ledger.update(fixture.actor, anonymous.id, { expectedVersion: anonymous.version, externalRecordKey: 'ID-2' }, randomUUID(), randomUUID());
    expect(changed).toMatchObject({ externalRecordKey: 'ID-2', sourceKind: 'IMS' });
  });

  it('enforces manual facts, quantity, derived-field ownership, and real registrant', async () => {
    await expect(fixture.manual({ traceCode: null })).rejects.toMatchObject({ status: 400 });
    await expect(fixture.manual({ defectQuantity: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(fixture.manual({ projectCode: 'FORGED' })).rejects.toMatchObject({ status: 400 });
    const row = await fixture.manual();
    expect(row).toMatchObject({ defectQuantity: 1, registeredByName: '真实登记人', sourceKind: 'MANUAL', shift: 'DAY' });
    await expect(fixture.ledger.update(fixture.actor, row.id, { expectedVersion: row.version, defectQuantity: null }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 400 });
  });

  it('clears corrected optional-field issues independently while preserving other unresolved issues', async () => {
    const created = await fixture.ingest(fixture.fields({ issues: ['lineName:INVALID', 'externalRecordKey:INVALID'] }));
    const first = await fixture.ledger.update(fixture.actor, created.id, { expectedVersion: 1, lineName: '真实产线' }, randomUUID(), randomUUID());
    expect(first.registrationIssues).not.toContain('lineName:INVALID');
    expect(first.registrationIssues).toContain('externalRecordKey:INVALID');
    const next = await fixture.ledger.update(fixture.actor, created.id, { expectedVersion: first.version, externalRecordKey: '0000123' }, randomUUID(), randomUUID());
    expect(next.registrationIssues).not.toContain('externalRecordKey:INVALID');
    expect(next.issues).not.toContain('SOURCE_IDENTITY_INCOMPLETE');
    expect(next.pendingCompletion).toBe(true);
  });

  it('protects original manual facts and their original sourceKind when a numbered IMS row later matches', async () => {
    const manual = await fixture.manual({ externalSourceSystem: 'IMS', externalRecordKey: 'MANUAL-IMS-KEY', sourceObservedAt: new Date('2026-11-16T00:00:00Z') });
    const input = fixture.fields({ externalRecordKey: 'MANUAL-IMS-KEY', description: 'IMS不同描述', factoryCode: null, issues: ['factory:INVALID'] });
    const inspected = await fixture.prisma.$transaction(tx => fixture.adapter.inspect(tx, fixture.actor, input));
    expect(inspected?.protectedFields).toEqual(expect.arrayContaining(['description', 'factoryCode']));
    await expect(fixture.ingest(input)).rejects.toMatchObject({ status: 409 });
    expect(await fixture.ledger.detail(fixture.actor, manual.id)).toMatchObject({ factoryCode: 'FACTORY_1' });
    await fixture.ingest(input, true);
    expect(await fixture.ledger.detail(fixture.actor, manual.id)).toMatchObject({ sourceKind: 'MANUAL', description: 'IMS不同描述', createdById: fixture.actor.id,
      factoryCode: null, pendingCompletion: true, registrationIssues: ['factory:INVALID'] });
  });

  it('clears prior source issues for valid supplied facts even when their final value is unchanged', async () => {
    const input = fixture.fields({ externalRecordKey: 'SOURCE-CORRECTION', occurredAt: '2026-11-16T00:30:00.000Z', productCode: '00001',
      traceCode: 'TRACE', description: '已保留合法描述片段', issues: ['lineName:INVALID', 'description:TYPE'] });
    const first = await fixture.ingest(input);
    const updated = await fixture.ingest({ ...input, lineName: '已修正产线', issues: [] });
    expect(updated.version).toBeGreaterThan(first.version);
    expect(await fixture.ledger.detail(fixture.actor, first.id)).toMatchObject({ lineName: '已修正产线', registrationIssues: [], pendingCompletion: false });
  });

  it('persists issue-only changes and clears only issues whose fields were explicitly supplied as valid', async () => {
    const input = fixture.fields({ externalRecordKey: 'ISSUE-ONLY', occurredAt: '2026-11-16T00:30:00.000Z', productCode: '00001',
      traceCode: 'TRACE', description: '同一合法片段', issues: ['lineName:INVALID'] });
    const first = await fixture.ingest(input);
    const invalid = await fixture.ingest({ ...input, issues: ['description:TYPE'] });
    expect(invalid.version).toBe(first.version + 1);
    expect((await fixture.ledger.detail(fixture.actor, first.id)).registrationIssues).toEqual(expect.arrayContaining(['lineName:INVALID', 'description:TYPE']));
    const corrected = await fixture.ingest({ ...input, issues: [] });
    expect(corrected.version).toBe(invalid.version + 1);
    const row = await fixture.ledger.detail(fixture.actor, first.id);
    expect(row.registrationIssues).toEqual(['lineName:INVALID']);
    expect(row.pendingCompletion).toBe(true);
  });

  it('protects original legacy MANUAL facts and preserves unknown quantity/stage through an explicit IMS adoption', async () => {
    const legacy = await fixture.prisma.processDefect.create({ data: { organizationId: fixture.actor.organizationId, description: '旧人工资料',
      externalSourceSystem: 'IMS', externalRecordKey: 'LEGACY-MANUAL', sourceObservedAt: new Date('2026-11-16T00:00:00Z'),
      ingestionStatus: 'PENDING_VERIFICATION', createdById: fixture.actor.id, updatedById: fixture.actor.id } });
    const input = fixture.fields({ externalRecordKey: 'LEGACY-MANUAL', description: '来源差异' });
    await expect(fixture.ingest(input)).rejects.toMatchObject({ status: 409, response: { code: 'PROCESS_DEFECT_MANUAL_CONFIRMATION_REQUIRED' } });
    await fixture.ingest(input, true);
    expect(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ sourceKind: 'MANUAL', defectQuantity: null,
      occurredAt: null, projectSnapshot: null, registrationVersion: null, description: '来源差异' });
  });

  it('uses the trusted previously linked target when a later merged receipt row has no current source number', async () => {
    const first = await fixture.ingest(fixture.fields({ externalRecordKey: 'MERGED-KEY', description: 'A行' }));
    const secondReceipt = await fixture.receipt();
    await fixture.ingest({ receiptId: secondReceipt.id, rowIndex: 0, externalRecordKey: 'MERGED-KEY', description: 'B行' });
    const anonymous = { receiptId: secondReceipt.id, rowIndex: 0, description: 'B行重处理' };
    const result = await fixture.prisma.$transaction(async tx => {
      const linked = await Reflect.apply(fixture.adapter.inspect, fixture.adapter, [tx, fixture.actor, anonymous, first.id]);
      expect(linked?.id).toBe(first.id);
      return fixture.adapter.write(tx, fixture.actor, anonymous, { id: linked.id, version: linked.version }, randomUUID());
    });
    expect(result.id).toBe(first.id);
    const stored = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored).toMatchObject({ sourceReceiptId: fixture.fields().receiptId, externalRecordKey: 'MERGED-KEY', description: 'B行重处理' });
    expect(await fixture.prisma.processDefect.count({ where: { organizationId: fixture.actor.organizationId } })).toBe(1);
  });

  it('rejects a trusted row link that conflicts with a different numbered target', async () => {
    const first = await fixture.ingest(fixture.fields({ externalRecordKey: 'LINK-A' }));
    await fixture.ingest(fixture.fields({ rowIndex: 1, externalRecordKey: 'LINK-B' }));
    const secondReceipt = await fixture.receipt();
    await expect(fixture.prisma.$transaction(tx => Reflect.apply(fixture.adapter.inspect, fixture.adapter,
      [tx, fixture.actor, { receiptId: secondReceipt.id, rowIndex: 0, externalRecordKey: 'LINK-B' }, first.id])))
      .rejects.toMatchObject({ status: 409, response: { code: 'PROCESS_DEFECT_EXTERNAL_IDENTITY_CONFLICT' } });
    expect(await fixture.prisma.processDefect.count({ where: { organizationId: fixture.actor.organizationId } })).toBe(2);
  });

  it('audits work order, line code, operation code and source observation time as actual before/after facts', async () => {
    const first = await fixture.ingest(fixture.fields({ externalRecordKey: 'FACT-AUDIT', workOrderCode: 'WO-1', lineCode: 'L-1', operationCode: 'OP-1', sourceObservedAt: '2026-11-16T00:00:00.000Z' }));
    await fixture.ledger.update(fixture.actor, first.id, { expectedVersion: first.version, workOrderCode: 'WO-2', lineCode: 'L-2', operationCode: 'OP-2' }, randomUUID(), randomUUID());
    await fixture.ingest(fixture.fields({ externalRecordKey: 'FACT-AUDIT', sourceObservedAt: '2026-11-16T01:00:00.000Z' }));
    const changes = await fixture.prisma.$queryRaw<{ action: string; before_facts: Record<string, unknown>; after_facts: Record<string, unknown> }[]>`
      SELECT action,before_facts,after_facts FROM process_defect_registration_history WHERE defect_id = ${first.id}::uuid AND defect_version > 1 ORDER BY defect_version`;
    expect(changes[0]).toMatchObject({ action: 'MANUAL_UPDATED', before_facts: { workOrderCode: 'WO-1', lineCode: 'L-1', operationCode: 'OP-1' },
      after_facts: { workOrderCode: 'WO-2', lineCode: 'L-2', operationCode: 'OP-2' } });
    expect(changes[1]).toMatchObject({ action: 'IMS_UPDATED', before_facts: { sourceObservedAt: '2026-11-16T00:00:00.000Z' },
      after_facts: { sourceObservedAt: '2026-11-16T01:00:00.000Z' } });
  });
});
