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

  async function completePending(id: string) {
    const pendingCount = await fixture.prisma.processDefect.count({ where: { registrationVersion: 1, pendingConfiguration: true, archivedAt: null } });
    for (let cycle = 0; cycle <= Math.ceil(pendingCount / 100); cycle++) {
      await fixture.completion.processDue(100);
      if (!(await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id } })).pendingConfiguration) return;
    }
    throw new Error('The bounded Worker did not reach the pending fixture');
  }

  it('freezes a first project stage and later fills only the independent missing subtype', async () => {
    const mapped = await mapping('00001');
    await fixture.prisma.$executeRaw`UPDATE component_project_mappings SET product_category = NULL WHERE id = ${mapped.component.id}::uuid`;
    const first = await fixture.manual({ operationName: '工序甲' });
    expect(first).toMatchObject({ projectStage: 'NEW_PRODUCT', productSubcategory: null });
    const saved = await fixture.prisma.processDefect.findUniqueOrThrow({ where: { id: first.id } });
    expect(saved.projectSnapshot).not.toHaveProperty('project.createdByUserId');
    expect(saved.projectSnapshot).not.toHaveProperty('project.projectEngineerAssignmentId');
    await fixture.mappings.updateProject(fixture.actor, fixture.actor.organizationId, mapped.project.id,
      { expectedVersion: 1, stage: 'MASS_PRODUCTION', name: '已转量产' }, randomUUID(), randomUUID());
    await fixture.mappings.updateMapping(fixture.actor, fixture.actor.organizationId, mapped.component.id,
      { expectedVersion: 1, productSubcategory: '细分类' }, randomUUID(), randomUUID());
    await fixture.sectors.create(fixture.actor, { operationName: ' 工序甲 ', sectorName: '制造板块' }, randomUUID(), randomUUID());
    await completePending(first.id);
    const completed = await fixture.ledger.detail(fixture.actor, first.id);
    expect(completed).toMatchObject({ projectStage: 'NEW_PRODUCT', projectName: '初始项目', productSubcategory: '细分类', operationSector: '制造板块', pendingConfiguration: false });
    expect(completed.componentProject?.project?.stage).toBe('NEW_PRODUCT');
    const next = await fixture.manual({ operationName: '工序甲' });
    expect(next).toMatchObject({ projectStage: 'MASS_PRODUCTION', projectName: '已转量产' });
    const restarted = new ProcessDefectCompletionService(fixture.prisma, fixture.audit, fixture.mappings);
    await restarted.processDue(100);
    expect((await fixture.ledger.detail(fixture.actor, first.id)).version).toBe(completed.version);
  });

  it('completes only pending active nonarchived records and does not invent legacy facts', async () => {
    const active = await fixture.manual({ productCode: 'LATER', operationName: 'OP' });
    const archived = await fixture.manual({ productCode: 'LATER', operationName: 'OP' });
    await fixture.ledger.archive(fixture.actor, archived.id, archived.version, randomUUID(), randomUUID());
    const legacy = await fixture.prisma.processDefect.create({ data: { organizationId: fixture.actor.organizationId, description: '旧未知', productCode: 'LATER', createdById: fixture.actor.id, updatedById: fixture.actor.id } });
    await mapping('LATER', '类型');
    await fixture.sectors.create(fixture.actor, { operationName: 'OP', sectorName: '板块' }, randomUUID(), randomUUID());
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
    await fixture.sectors.create(fixture.actor, { operationName: 'OP', sectorName: '甲' }, randomUUID(), randomUUID());
    const beta = await fixture.sectors.create(fixture.actor, { operationName: 'NEXT', sectorName: '乙' }, randomUUID(), randomUUID());
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
    const rule = await fixture.sectors.create(fixture.actor, { operationName: '  OP ', sectorName: '甲' }, randomUUID(), randomUUID());
    await expect(fixture.sectors.create(fixture.actor, { operationName: 'OP', sectorName: '乙' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await fixture.sectors.update(fixture.actor, rule.id, { expectedVersion: 1, operationName: 'OP', sectorName: '乙', active: false }, randomUUID(), randomUUID());
    await expect(fixture.sectors.update(fixture.actor, rule.id, { expectedVersion: 1, operationName: 'OP', sectorName: '丙', active: true }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const permission = await fixture.prisma.permission.findUniqueOrThrow({ where: { code: 'configuration:manage' } });
    await fixture.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: fixture.role.id, permissionId: permission.id } } });
    await expect(fixture.sectors.create(fixture.actor, { operationName: 'OTHER', sectorName: '丙' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
  });

  it('rolls back a real database audit failure and persists a bounded retry without false completion', async () => {
    const record = await fixture.manual({ productCode: 'FAIL-COMPONENT', operationName: 'FAIL-OP' });
    await mapping('FAIL-COMPONENT', '类型');
    await fixture.sectors.create(fixture.actor, { operationName: 'FAIL-OP', sectorName: '板块' }, randomUUID(), randomUUID());
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
    await fixture.sectors.create(fixture.actor, { operationName: 'ORIGINAL', sectorName: '甲' }, randomUUID(), randomUUID());
    await fixture.sectors.create(fixture.actor, { operationName: 'CORRECTED', sectorName: '乙' }, randomUUID(), randomUUID());
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
