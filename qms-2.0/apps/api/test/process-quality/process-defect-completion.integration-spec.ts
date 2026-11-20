import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client.js';
import { ProcessDefectCompletionService } from '../../src/modules/process-quality/process-defect-completion.service.js';
import { processIngestionFixture, type ProcessIngestionFixture } from './process-defect-ingestion.fixture.js';

describe('process registration snapshots and real bounded Worker completion', () => {
  let fixture: ProcessIngestionFixture;
  beforeEach(async () => { fixture = await processIngestionFixture(); });
  afterEach(async () => { await fixture?.prisma.$disconnect(); });

  async function mapping(code: string, subcategory?: string) {
    const project = await fixture.mappings.createProject(fixture.actor, fixture.actor.organizationId,
      { code: randomUUID(), name: '初始项目', stage: 'NEW_PRODUCT' }, randomUUID(), randomUUID());
    const component = await fixture.mappings.createMapping(fixture.actor, fixture.actor.organizationId,
      { componentCode: code, projectRecordId: project.id, productCategory: '产品类别', productSubcategory: subcategory }, randomUUID(), randomUUID());
    return { project, component };
  }

  async function due(id: string) { await fixture.prisma.processDefect.update({ where: { id }, data: { completionNextAttemptAt: null } }); }

  async function seedLegacySector(operationName: string, sectorName: string) {
    const id = randomUUID();
    const { actor, prisma } = fixture;
    await prisma.$executeRaw`INSERT INTO process_operation_sectors
      (id, organization_id, operation_name, sector_name, created_by_id, updated_by_id)
      VALUES (${id}::uuid, ${actor.organizationId}::uuid, ${operationName}, ${sectorName}, ${actor.id}::uuid, ${actor.id}::uuid)`;
    return { id };
  }

  it('accepts old API sector inserts after the operation master migration', async () => {
    const id = randomUUID();
    const { actor, prisma } = fixture;
    const operationName = '旧接口新增工序';
    const insertLegacy = () => prisma.$executeRaw`INSERT INTO process_operation_sectors
      (id, organization_id, operation_name, sector_name, created_by_id, updated_by_id)
      VALUES (${id}::uuid, ${actor.organizationId}::uuid, ${operationName}, '旧板块', ${actor.id}::uuid, ${actor.id}::uuid)
      ON CONFLICT (organization_id, operation_name) DO NOTHING`;
    expect(await insertLegacy()).toBe(1);
    expect(await insertLegacy()).toBe(0);
    expect(await fixture.sectors.list(actor)).toContainEqual(expect.objectContaining({ id, operationName, operationCode: null, sectorName: '旧板块' }));
  });

  it('allows routine configuration with an active session after recent authentication expires', async () => {
    await fixture.prisma.session.update({ where: { id: fixture.actor.sessionId }, data: { reauthenticatedAt: new Date(Date.now() - 600_000) } });
    const { component } = await mapping('ACTIVE-CONFIG');
    expect(component.productCategory).toBe('产品类别');
    const sector = await fixture.sectors.create(fixture.actor, { operationCode: 'ACTIVE-CONFIG', operationName: '跳动测试', sectorName: '装配' }, randomUUID(), randomUUID());
    expect(sector.sectorName).toBe('装配');
    await fixture.prisma.session.update({ where: { id: fixture.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await expect(mapping('EXPIRED-CONFIG')).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
  });

  async function completePending(id: string) {
    const pendingCount = await fixture.prisma.processDefect.count({ where: { registrationVersion: 1, pendingConfiguration: true, archivedAt: null } });
    for (let cycle = 0; cycle <= Math.ceil(pendingCount / 100); cycle++) {
      await fixture.completion.processDue(100);
      if (!(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id } })).pendingConfiguration) return;
    }
    throw new Error('The bounded Worker did not reach the pending fixture');
  }

  it('uses code before name, leaves names ambiguous, and freezes completed board snapshots', async () => {
    await mapping('00001', '细分类');
    const legacy = await seedLegacySector('重名工序', '历史板块');
    const onlyName = await fixture.manual({ operationName: '重名工序' });
    expect(onlyName.operationSector).toBe('历史板块');
    const initial = await fixture.manual({ operationCode: 'OP-1', operationName: '重名工序' });
    expect(initial.operationSector).toBeNull();
    const bound = await fixture.sectors.update(fixture.actor, legacy.id,
      { operationCode: 'OP-1', operationName: '重名工序', sectorName: '现行板块', expectedVersion: 1, active: true }, randomUUID(), randomUUID());
    expect(bound).toMatchObject({ id: legacy.id, operationCode: 'OP-1' });
    await fixture.sectors.create(fixture.actor, { operationCode: 'OP-2', operationName: '重名工序', sectorName: null }, randomUUID(), randomUUID());
    expect((await fixture.manual({ operationName: '重名工序' })).operationSector).toBeNull();
    expect((await fixture.manual({ operationCode: 'UNKNOWN', operationName: '重名工序' })).operationSector).toBeNull();
    await completePending(initial.id);
    const completed = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: initial.id } });
    expect(completed).toMatchObject({ operationSector: '现行板块', sectorSnapshot: { ruleId: legacy.id, operationCode: 'OP-1', ruleVersion: 2 } });
    const renamed = await fixture.ledger.update(fixture.actor, initial.id, { expectedVersion: completed.version, operationName: '同步后的名称' }, randomUUID(), randomUUID());
    expect(renamed.operationSector).toBe('现行板块');
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: initial.id } })).sectorSnapshot).toEqual(completed.sectorSnapshot);
    expect((await fixture.ledger.detail(fixture.actor, onlyName.id)).operationSector).toBe('历史板块');
  });

  it('rejects duplicate and changed codes and honors optional manual board updates', async () => {
    const sector = await fixture.sectors.create(fixture.actor, { operationCode: 'A', operationName: '工序甲', sectorName: '板块' }, randomUUID(), randomUUID());
    await expect(fixture.sectors.create(fixture.actor, { operationCode: ' A ', operationName: '同编码' }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ response: { code: 'PROCESS_OPERATION_CODE_CONFLICT' } });
    const legacy = await seedLegacySector('历史工序', '板块');
    await expect(fixture.sectors.update(fixture.actor, legacy.id, { operationCode: 'A', operationName: '历史工序', expectedVersion: 1, active: true }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ response: { code: 'PROCESS_OPERATION_CODE_CONFLICT' } });
    const patch = { operationName: '工序甲', expectedVersion: sector.version, active: true };
    await expect(fixture.sectors.update(fixture.actor, sector.id, { ...patch, operationCode: 'B' }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ response: { code: 'PROCESS_OPERATION_CODE_IMMUTABLE' } });
    const preserved = await fixture.sectors.update(fixture.actor, sector.id, patch, randomUUID(), randomUUID());
    expect(preserved).toMatchObject({ operationCode: 'A', sectorName: '板块' });
    expect(await fixture.sectors.update(fixture.actor, sector.id, { ...patch, expectedVersion: preserved.version, sectorName: null }, randomUUID(), randomUUID()))
      .toMatchObject({ operationCode: 'A', sectorName: null });
  });

  it('preserves a frozen board when enriching a same-name defect with a code, and rematches a corrected code', async () => {
    await seedLegacySector('同一工序', '历史板块');
    const first = await fixture.manual({ operationName: '同一工序' });
    const before = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: first.id } });
    await fixture.sectors.create(fixture.actor, { operationCode: 'NEW-CODE', operationName: '同一工序', sectorName: '现行板块' }, randomUUID(), randomUUID());
    await fixture.sectors.create(fixture.actor, { operationCode: 'OTHER-CODE', operationName: '同一工序', sectorName: '其他板块' }, randomUUID(), randomUUID());
    const enriched = await fixture.ledger.update(fixture.actor, first.id,
      { expectedVersion: first.version, operationCode: 'NEW-CODE', operationName: ' 同一工序 ' }, randomUUID(), randomUUID());
    expect(enriched).toMatchObject({ operationCode: 'NEW-CODE', operationSector: '历史板块' });
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: first.id } })).sectorSnapshot).toEqual(before.sectorSnapshot);
    const corrected = await fixture.ledger.update(fixture.actor, first.id, { expectedVersion: enriched.version, operationCode: 'OTHER-CODE' }, randomUUID(), randomUUID());
    expect(corrected).toMatchObject({ operationCode: 'OTHER-CODE', operationSector: '其他板块' });
  });

  it('keeps legacy boards frozen and defers uncoded matches when ingestion creates same-name operations', async () => {
    const operationName = '旧规则与同步工序同名';
    await seedLegacySector(operationName, '旧板块');
    const frozen = await fixture.manual({ operationName });
    const imported = await fixture.prisma.$transaction(tx => fixture.sectors.writeForIngestion(tx, fixture.actor,
      { operationCode: 'IMS-1', operationName }, null, randomUUID()));
    const pending = await fixture.manual({ operationName });
    expect(pending).toMatchObject({ operationSector: null, pendingConfiguration: true });
    await fixture.prisma.$transaction(tx => fixture.sectors.writeForIngestion(tx, fixture.actor,
      { operationCode: 'IMS-2', operationName }, null, randomUUID()));
    await fixture.sectors.update(fixture.actor, imported.id, { operationName, sectorName: '已核对板块', active: true, expectedVersion: 1 }, randomUUID(), randomUUID());
    expect((await fixture.manual({ operationName })).operationSector).toBeNull();
    expect((await fixture.manual({ operationCode: 'IMS-2', operationName })).operationSector).toBeNull();
    const identified = await fixture.ledger.update(fixture.actor, pending.id, { expectedVersion: pending.version, operationCode: 'IMS-1' }, randomUUID(), randomUUID());
    expect(identified.operationSector).toBe('已核对板块');
    expect((await fixture.ledger.detail(fixture.actor, frozen.id)).operationSector).toBe('旧板块');
  });

  it('requires operation permissions at the transactional ingestion boundary and keeps source names out of audit metadata', async () => {
    const fields = { operationCode: 'AUTH-A', operationName: '来源名称应留在业务记录' };
    const actor = { ...fixture.actor, id: randomUUID() };
    await expect(fixture.prisma.$transaction(tx => fixture.sectors.inspectForIngestion(tx, actor, fields)))
      .rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
    const record = await fixture.prisma.$transaction(tx => fixture.sectors.writeForIngestion(tx, fixture.actor, fields, null, randomUUID()));
    const events = await fixture.prisma.auditEvent.findMany({ where: { resourceId: record.id } });
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({ resourceVersion: 1, target: 'OPERATION' });
  });

  it('freezes the first project stage and fills missing product classification independently', async () => {
    const mapped = await mapping('00001');
    await fixture.prisma.$executeRaw`UPDATE component_project_mappings SET product_category = NULL WHERE id = ${mapped.component.id}::uuid`;
    const first = await fixture.manual({ operationName: '工序甲' });
    expect(first).toMatchObject({ projectStage: 'NEW_PRODUCT', productCategory: null, productSubcategory: null });
    const saved = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: first.id } });
    expect(saved.projectSnapshot).not.toHaveProperty('project.createdByUserId');
    expect(saved.projectSnapshot).not.toHaveProperty('project.projectEngineerAssignmentId');
    await fixture.mappings.updateProject(fixture.actor, fixture.actor.organizationId, mapped.project.id,
      { expectedVersion: 1, stage: 'MASS_PRODUCTION', name: '已转量产' }, randomUUID(), randomUUID());
    await fixture.mappings.updateMapping(fixture.actor, fixture.actor.organizationId, mapped.component.id,
      { expectedVersion: 1, productCategory: '产品类别', productSubcategory: '细分类' }, randomUUID(), randomUUID());
    await seedLegacySector('工序甲', '制造板块');
    await completePending(first.id);
    const completed = await fixture.ledger.detail(fixture.actor, first.id);
    expect(completed).toMatchObject({ projectStage: 'NEW_PRODUCT', projectName: '初始项目', productCategory: '产品类别', productSubcategory: '细分类', operationSector: '制造板块', pendingConfiguration: false });
    expect(completed.componentProject?.mapping.productCategory).toBe('产品类别');
    expect(completed.componentProject?.project?.stage).toBe('NEW_PRODUCT');
    const next = await fixture.manual({ operationName: '工序甲' });
    expect(next).toMatchObject({ projectStage: 'MASS_PRODUCTION', projectName: '已转量产' });
    const restarted = new ProcessDefectCompletionService(fixture.prisma, fixture.audit, fixture.mappings);
    await restarted.processDue(100);
    expect((await fixture.ledger.detail(fixture.actor, first.id)).version).toBe(completed.version);
  });

  it('captures and backfills the first active mapping product type even without a project', async () => {
    const productCode = 'NO-PROJECT';
    await fixture.mappings.importComponents(fixture.actor, fixture.actor.organizationId,
      { rows: [{ rowNumber: 1, componentCode: productCode, componentName: '成品' }] }, randomUUID(), randomUUID());
    const [mappingRow] = await fixture.prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM component_project_mappings
      WHERE organization_id = ${fixture.actor.organizationId}::uuid AND component_code = ${productCode}`;
    const first = await fixture.manual({ productCode });
    expect(first).toMatchObject({ productCategory: null, componentProject: null, pendingConfiguration: true });
    await fixture.mappings.updateMapping(fixture.actor, fixture.actor.organizationId, mappingRow!.id,
      { expectedVersion: 1, productCategory: '首次类别', status: 'DISABLED' }, randomUUID(), randomUUID());
    await fixture.completion.processDue(100);
    expect(await fixture.ledger.detail(fixture.actor, first.id)).toMatchObject({ productCategory: null, version: first.version });

    await fixture.mappings.updateMapping(fixture.actor, fixture.actor.organizationId, mappingRow!.id,
      { expectedVersion: 2, status: 'ACTIVE' }, randomUUID(), randomUUID());
    const registered = await fixture.manual({ productCode });
    expect(registered.productCategory).toBe('首次类别');
    await due(first.id);
    await fixture.completion.processDue(100);
    expect(await fixture.ledger.detail(fixture.actor, first.id)).toMatchObject({ productCategory: '首次类别', componentProject: null,
      productSubcategory: null, pendingConfiguration: true, version: first.version + 1 });
    const histories = await fixture.prisma.$queryRaw<Array<{ before: string | null; after: string }>>`SELECT
      before_facts ->> 'productCategory' AS "before", after_facts ->> 'productCategory' AS "after"
      FROM process_defect_registration_history WHERE defect_id = ${first.id}::uuid AND action = 'AUTO_COMPLETED'`;
    expect(histories).toEqual([{ before: null, after: '首次类别' }]);

    await fixture.mappings.updateMapping(fixture.actor, fixture.actor.organizationId, mappingRow!.id,
      { expectedVersion: 3, productCategory: '新版类别' }, randomUUID(), randomUUID());
    await due(first.id);
    await fixture.completion.processDue(100);
    const listed = await fixture.ledger.list(fixture.actor, { page: 1, pageSize: 10, productCode });
    expect(listed.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, productCategory: '首次类别', version: first.version + 1 }),
      expect.objectContaining({ id: registered.id, productCategory: '首次类别' }),
    ]));
    expect((await fixture.manual({ productCode })).productCategory).toBe('新版类别');
  });

  it('recalculates product type only when the record product code changes', async () => {
    const original = await mapping('00001', '甲类');
    const replacement = await mapping('REPLACEMENT', '乙类');
    await fixture.mappings.updateMapping(fixture.actor, fixture.actor.organizationId, replacement.component.id,
      { expectedVersion: 1, productCategory: '替代类别' }, randomUUID(), randomUUID());
    const first = await fixture.manual();
    await fixture.mappings.updateMapping(fixture.actor, fixture.actor.organizationId, original.component.id,
      { expectedVersion: 1, productCategory: '变更类别' }, randomUUID(), randomUUID());
    const edited = await fixture.ledger.update(fixture.actor, first.id, { expectedVersion: first.version, description: '补充说明' }, randomUUID(), randomUUID());
    expect(edited.productCategory).toBe('产品类别');
    const corrected = await fixture.ledger.update(fixture.actor, first.id, { expectedVersion: edited.version, productCode: 'REPLACEMENT' }, randomUUID(), randomUUID());
    expect(corrected).toMatchObject({ productCategory: '替代类别', productSubcategory: '乙类' });
    const unmapped = await fixture.ledger.update(fixture.actor, first.id, { expectedVersion: corrected.version, productCode: 'UNMAPPED' }, randomUUID(), randomUUID());
    expect(unmapped).toMatchObject({ productCategory: null, productSubcategory: null, pendingConfiguration: true });
  });

  it('completes product type as the only missing configuration on an upgrade-queued record', async () => {
    const productCode = 'CATEGORY-UPGRADE';
    const mapped = await mapping(productCode, '历史细类');
    await fixture.prisma.$executeRaw`UPDATE component_project_mappings SET product_category = NULL WHERE id = ${mapped.component.id}::uuid`;
    await seedLegacySector('升级工序', '历史板块');
    const before = await fixture.manual({ productCode, operationName: '升级工序' });
    await fixture.prisma.processDefect.update({ where: { id: before.id }, data: { pendingConfiguration: false } });
    await fixture.mappings.updateMapping(fixture.actor, fixture.actor.organizationId, mapped.component.id,
      { expectedVersion: 1, productCategory: '补录类别', productSubcategory: '新版细类' }, randomUUID(), randomUUID());
    await fixture.completion.processDue(100);
    expect(await fixture.ledger.detail(fixture.actor, before.id)).toMatchObject({ productCategory: null, pendingConfiguration: false, version: before.version });
    await fixture.prisma.processDefect.update({ where: { id: before.id }, data: { pendingConfiguration: true, completionNextAttemptAt: null } });

    await completePending(before.id);
    expect(await fixture.ledger.detail(fixture.actor, before.id)).toMatchObject({ productCategory: '补录类别', productSubcategory: '历史细类',
      projectName: '初始项目', projectStage: 'NEW_PRODUCT', operationSector: '历史板块', pendingConfiguration: false, version: before.version + 1 });
  });

  it('completes only pending active nonarchived records and does not invent legacy facts', async () => {
    const active = await fixture.manual({ productCode: 'LATER', operationName: 'OP' });
    const archived = await fixture.manual({ productCode: 'LATER', operationName: 'OP' });
    const deletePermission = await fixture.prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:defects:delete' } });
    await fixture.prisma.rolePermission.create({ data: { roleId: fixture.role.id, permissionId: deletePermission.id } });
    await fixture.ledger.archive(fixture.actor, archived.id, archived.version, randomUUID(), randomUUID());
    const legacy = await fixture.prisma.processDefect.create({ data: { organizationId: fixture.actor.organizationId, description: '旧未知', productCode: 'LATER', createdById: fixture.actor.id, updatedById: fixture.actor.id } });
    await mapping('LATER', '类型');
    await seedLegacySector('OP', '板块');
    await fixture.prisma.organization.update({ where: { id: fixture.actor.organizationId }, data: { status: 'DISABLED' } });
    await fixture.completion.processDue(100);
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: active.id } })).version).toBe(1);
    await fixture.prisma.organization.update({ where: { id: fixture.actor.organizationId }, data: { status: 'ACTIVE' } });
    await fixture.completion.processDue(100);
    expect((await fixture.ledger.detail(fixture.actor, active.id)).pendingConfiguration).toBe(false);
    expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: archived.id } })).projectSnapshot).toBeNull();
    expect(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ occurredAt: null, defectQuantity: null, projectSnapshot: null, registrationVersion: null });
  });

  it('recomputes only an explicitly corrected dependency and retains audit/version guards', async () => {
    await mapping('00001', '甲类');
    const first = await fixture.manual({ operationName: 'OP' });
    await seedLegacySector('OP', '甲');
    const beta = await seedLegacySector('NEXT', '乙');
    const edited = await fixture.ledger.update(fixture.actor, first.id, { expectedVersion: first.version, operationName: 'NEXT' }, randomUUID(), randomUUID());
    expect(edited).toMatchObject({ operationSector: '乙', projectStage: 'NEW_PRODUCT' });
    await expect(fixture.ledger.update(fixture.actor, first.id, { expectedVersion: first.version, operationName: 'OP' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await fixture.sectors.update(fixture.actor, beta.id, { expectedVersion: 1, operationName: 'NEXT', sectorName: '丙', active: true }, randomUUID(), randomUUID());
    await due(first.id);
    await fixture.completion.processDue(100);
    expect((await fixture.ledger.detail(fixture.actor, first.id)).operationSector).toBe('乙');
    const histories = await fixture.prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM process_defect_registration_history WHERE defect_id = ${first.id}::uuid`;
    expect(Number(histories[0]!.count)).toBe(2);
  });

  it('rejects duplicate trimmed operation names, stale configuration and unauthorized actors', async () => {
    const rule = await seedLegacySector('OP', '甲');
    const otherRule = await seedLegacySector('OTHER', '乙');
    await expect(fixture.sectors.update(fixture.actor, otherRule.id, { expectedVersion: 1, operationName: '  OP ', active: true }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 409, response: { code: 'PROCESS_OPERATION_SECTOR_NAME_CONFLICT' } });
    await fixture.sectors.update(fixture.actor, rule.id, { expectedVersion: 1, operationName: 'OP', sectorName: '乙', active: false }, randomUUID(), randomUUID());
    await expect(fixture.sectors.update(fixture.actor, rule.id, { expectedVersion: 1, operationName: 'OP', sectorName: '丙', active: true }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const permission = await fixture.prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:configuration:manage' } });
    await fixture.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: fixture.role.id, permissionId: permission.id } } });
    await expect(fixture.sectors.create(fixture.actor, { operationCode: 'OTHER', operationName: 'OTHER', sectorName: '丙' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
  });

  it('rolls back a real database audit failure and persists a bounded retry without false completion', async () => {
    const record = await fixture.manual({ productCode: 'FAIL-COMPONENT', operationName: 'FAIL-OP' });
    await mapping('FAIL-COMPONENT', '类型');
    await seedLegacySector('FAIL-OP', '板块');
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = Prisma.raw(`s2_completion_failure_${suffix}`), triggerName = Prisma.raw(`s2_completion_failure_${suffix}`);
    await fixture.prisma.$executeRaw(Prisma.sql`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN IF NEW.action = ''AUTO_COMPLETED'' THEN RAISE EXCEPTION ''S2 controlled audit failure''; END IF; RETURN NEW; END'`);
    await fixture.prisma.$executeRaw(Prisma.sql`CREATE TRIGGER ${triggerName} BEFORE INSERT ON process_defect_registration_history FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    try {
      const result = await fixture.completion.processDue(100);
      expect(result.failed).toBeGreaterThan(0);
      expect(result.completed).toBe(0);
      const stored = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: record.id } });
      expect(stored).toMatchObject({ version: 1, projectSnapshot: null, pendingConfiguration: true, completionAttempts: 1 });
      expect(stored.completionNextAttemptAt).toBeInstanceOf(Date);
    } finally {
      await fixture.prisma.$executeRaw(Prisma.sql`DROP TRIGGER ${triggerName} ON process_defect_registration_history`);
      await fixture.prisma.$executeRaw(Prisma.sql`DROP FUNCTION ${functionName}()`);
    }
    await due(record.id);
    const restarted = new ProcessDefectCompletionService(fixture.prisma, fixture.audit, fixture.mappings);
    await restarted.processDue(100);
    expect((await fixture.ledger.detail(fixture.actor, record.id)).pendingConfiguration).toBe(false);
  });

  it('rolls back automatic completion when its transactional consumer fails and retries the same version', async () => {
    const row = await fixture.manual({ productCode: 'ATOMIC-COMPLETION' });
    await mapping('ATOMIC-COMPLETION', '事务细类');
    const result = await fixture.completion.processDue(100, async () => { throw new Error('Controlled consumer failure'); });
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ version: row.version, projectSnapshot: null, completionAttempts: 1 });
    const history = await fixture.prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM process_defect_registration_history WHERE defect_id=${row.id}::uuid AND action='AUTO_COMPLETED'`;
    expect(history[0]!.count).toBe(0);
    await due(row.id);
    const changes: Array<{ id: string; organizationId: string; previousVersion: number; version: number }> = [];
    await fixture.completion.processDue(100, async (_transaction, change) => { changes.push(change); });
    expect(changes).toContainEqual({ id: row.id, organizationId: fixture.actor.organizationId, previousVersion: row.version, version: row.version + 1 });
    expect((await fixture.ledger.detail(fixture.actor, row.id)).productSubcategory).toBe('事务细类');
  });
  it('reports an unavailable retry record without falsely completing or throwing the entire Worker cycle', async () => {
    const row = await fixture.manual({ productCode: 'RETRY-FAIL', operationName: 'RETRY-OP' });
    await mapping('RETRY-FAIL', '类型');
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = Prisma.raw(`s2_retry_failure_${suffix}`), triggerName = Prisma.raw(`s2_retry_failure_${suffix}`);
    await fixture.prisma.$executeRaw(Prisma.sql`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN IF NEW.id = ''${Prisma.raw(row.id)}''::uuid THEN RAISE EXCEPTION ''S2 controlled update failure''; END IF; RETURN NEW; END'`);
    await fixture.prisma.$executeRaw(Prisma.sql`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON process_defects FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    try {
      const result = await fixture.completion.processDue(100);
      expect(result).toMatchObject({ completed: 0, failed: expect.any(Number), unrecorded: 1 });
      expect(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ version: 1, projectSnapshot: null, completionAttempts: 0 });
    } finally {
      await fixture.prisma.$executeRaw(Prisma.sql`DROP TRIGGER ${triggerName} ON process_defects`);
      await fixture.prisma.$executeRaw(Prisma.sql`DROP FUNCTION ${functionName}()`);
    }
  });

  it('skips a concurrently locked row and never overwrites a human dependency correction', async () => {
    const row = await fixture.manual({ productCode: 'RACE-COMPONENT', operationName: 'ORIGINAL' });
    await mapping('RACE-COMPONENT', '类型');
    await seedLegacySector('ORIGINAL', '甲');
    await seedLegacySector('CORRECTED', '乙');
    let unlock!: () => void;
    let locked!: () => void;
    const lockReady = new Promise<void>(resolve => { locked = resolve; });
    const release = new Promise<void>(resolve => { unlock = resolve; });
    const blocker = fixture.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM process_defects WHERE id = ${row.id}::uuid FOR UPDATE`;
      locked();
      await release;
    });
    await lockReady;
    try {
      await fixture.completion.processDue(100);
      expect((await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: row.id } })).version).toBe(1);
    } finally { unlock(); await blocker; }
    const edited = await fixture.ledger.update(fixture.actor, row.id, { expectedVersion: 1, operationName: 'CORRECTED' }, randomUUID(), randomUUID());
    expect(edited.operationSector).toBe('乙');
    await fixture.completion.processDue(100);
    expect(await fixture.ledger.detail(fixture.actor, row.id)).toMatchObject({ version: edited.version, operationName: 'CORRECTED', operationSector: '乙' });
  });
});
