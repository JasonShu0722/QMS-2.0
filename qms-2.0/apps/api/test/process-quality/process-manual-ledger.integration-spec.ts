import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import { type ProcessDefectDto, type ProcessDefectMaterialInputDto } from '../../src/modules/process-quality/process-quality.dto.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('An independent disposable PostgreSQL database is required');

describe('N3 manual process ledger: real PostgreSQL and protected HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: ProcessDefectLedgerService;
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const supplierIds = [randomUUID(), randomUUID()];
  const csrf = randomUUID();
  const people = {
    leader: { id: randomUUID(), roleId: randomUUID(), cookie: '', sessionId: '', permissions: ['process-quality:defects:read', 'process-quality:defects:write'] },
    pqc: { id: randomUUID(), roleId: randomUUID(), cookie: '', sessionId: '', permissions: ['process-quality:defects:read', 'process-quality:defects:write', 'process-quality:defects:close'] },
    sqe: { id: randomUUID(), roleId: randomUUID(), cookie: '', sessionId: '', permissions: ['process-quality:defects:read', 'process-quality:materials:review'] },
    otherSqe: { id: randomUUID(), roleId: randomUUID(), cookie: '', sessionId: '', permissions: ['process-quality:defects:read', 'process-quality:materials:review'] },
  };
  let profileId: string;
  let secondProfileId: string;
  let foreignProfileId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    ledger = app.get(ProcessDefectLedgerService);
    const [server] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(server?.server_version_num)).toBeGreaterThanOrEqual(180000);
    for (const id of [organizationId, otherOrganizationId]) await prisma.organization.create({ data: { id, code: `N3-A-${id}`, name: 'N3 isolated scope', type: 'INTERNAL' } });
    for (const id of supplierIds) await prisma.organization.create({ data: { id, code: `N3-A-${id}`, name: 'N3 material supplier', type: 'SUPPLIER' } });
    for (const [name, person] of Object.entries(people)) {
      await prisma.user.create({ data: { id: person.id, organizationId, username: `N3-${name}-${person.id.slice(0, 8)}`, fullName: name === 'leader' ? '制程测试员' : null, passwordHash: 'test-only', accountType: 'INTERNAL' } });
      // Arbitrary role codes prove that authorization does not depend on names such as PQC/SQE.
      await prisma.role.create({ data: { id: person.roleId, organizationId, code: `R-${person.id}`, name: 'Isolated permissions' } });
      for (const code of person.permissions) {
        const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
        await prisma.rolePermission.create({ data: { roleId: person.roleId, permissionId: permission.id } });
      }
      await prisma.userRole.create({ data: { userId: person.id, organizationId, roleId: person.roleId } });
      const token = await app.get(SessionService).create(person.id, prisma, { reauthenticated: true });
      const session = await prisma.session.findFirstOrThrow({ where: { userId: person.id }, orderBy: { createdAt: 'desc' } });
      person.sessionId = session.id;
      person.cookie = `qms_session=${token}; qms_csrf=${csrf}`;
    }
    const profile = (ownerOrganizationId: string) => prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId, businessCode: randomUUID(), displayName: 'Supplier without a portal account' } });
    profileId = (await profile(organizationId)).id;
    secondProfileId = (await profile(organizationId)).id;
    foreignProfileId = (await profile(otherOrganizationId)).id;
  });

  afterAll(async () => { await app?.close(); });

  function send(who: keyof typeof people, method: 'post' | 'put' | 'patch', path: string, body: object, key: string = randomUUID()) {
    return request(app.getHttpServer())[method](`/api/v1/process-quality/${path}`).set('Cookie', people[who].cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }
  function read(id: string) { return request(app.getHttpServer()).get(`/api/v1/process-quality/defects/${id}`).set('Cookie', people.leader.cookie); }
  async function create(body: object = {}): Promise<ProcessDefectDto> { return (await send('leader', 'post', 'defects', { occurredAt: '2026-11-16T00:30:00Z', factoryCode: 'FACTORY_1', productCode: 'N3-PRODUCT', traceCode: randomUUID(), description: '现场不良事实', ...body }).expect(201)).body; }
  async function seedLegacySupplier(defect: ProcessDefectDto, supplierOrganizationId: string | null) {
    await prisma.$executeRaw`UPDATE process_defect_material_items SET supplier_profile_id = NULL, supplier_organization_id = ${supplierOrganizationId}::uuid
      WHERE id = ${defect.materials[0]!.id}::uuid`;
    await prisma.processDefect.update({ where: { id: defect.id }, data: { supplierOrganizationId } });
    return (await read(defect.id).expect(200)).body as ProcessDefectDto;
  }
  const actor = () => ({ id: people.leader.id, organizationId, accountType: 'INTERNAL' as const, sessionId: people.leader.sessionId });
  function editable(material: ProcessDefectDto['materials'][number]): ProcessDefectMaterialInputDto {
    const { id, materialCode, materialName, supplierOrganizationId, supplierProfileId, materialBatch, sqeUserId, notes } = material;
    return { id, materialCode, materialName, supplierOrganizationId, supplierProfileId, materialBatch, sqeUserId, notes };
  }

  function maintain(who: keyof typeof people, board: string, sources: { defectId: string; expectedVersion: number; fields: object; compareOnly?: boolean }[], key?: string) {
    return send(who, 'patch', 'defects/bulk-maintenance', { organizationId, board, sources }, key);
  }

  it('requires a material code and registered supplier for new material lines without requiring a master-data match', async () => {
    const defect = await create();
    const source = (material: ProcessDefectMaterialInputDto) => [{ defectId: defect.id, expectedVersion: defect.version,
      fields: { responsibilityCategory: 'MATERIAL', materials: [material] } }];
    const code = `unmatched-${randomUUID()}`;
    await maintain('leader', 'RESPONSIBILITY', source({ materialCode: code })).expect(400);
    await maintain('leader', 'RESPONSIBILITY', source({ supplierProfileId: profileId })).expect(400);
    await maintain('leader', 'RESPONSIBILITY', source({ materialCode: code, supplierOrganizationId: supplierIds[0] })).expect(400);
    const saved = (await maintain('leader', 'RESPONSIBILITY', source({ materialCode: code, supplierProfileId: profileId })).expect(200)).body.items[0] as ProcessDefectDto;
    expect(saved.materials[0]).toMatchObject({ materialCode: code, materialName: null, supplierProfileId: profileId });
    for (const field of ['materialCode', 'supplierProfileId'] as const) {
      await maintain('leader', 'RESPONSIBILITY', [{ defectId: defect.id, expectedVersion: saved.version,
        fields: { materials: [{ id: saved.materials[0]!.id, [field]: null }] } }]).expect(400);
    }
  });

  it('enforces new material requirements through both manual registration endpoints', async () => {
    const registration = { occurredAt: '2026-11-16T00:30:00Z', factoryCode: 'FACTORY_1', productCode: 'N3-PRODUCT', traceCode: randomUUID(), description: '登记物料' };
    const defect = await create();
    const code = `unmatched-${randomUUID()}`;
    for (const input of [
      { materials: [{}] },
      { materials: [{ materialCode: '   ' }] },
      { materials: [{ materialCode: code }] },
      { materials: [{ supplierProfileId: profileId }] },
      { materialCode: code, supplierOrganizationId: supplierIds[0] },
    ]) {
      await send('leader', 'post', 'defects', { ...registration, ...input }).expect(400);
      await send('leader', 'put', `defects/${defect.id}`, { ...input, expectedVersion: defect.version }).expect(400);
    }
    const material = { materialCode: code, supplierProfileId: profileId };
    expect((await create({ materials: [material] })).materials[0]).toMatchObject({ ...material, materialName: null });
    const saved = (await send('leader', 'put', `defects/${defect.id}`, { expectedVersion: defect.version, materials: [material] }).expect(200)).body;
    expect(saved.materials[0]).toMatchObject({ ...material, materialName: null });
    await send('leader', 'put', `defects/${defect.id}`, {
      expectedVersion: saved.version, materials: [{ id: saved.materials[0].id, supplierProfileId: null }],
    }).expect(400);
    await send('leader', 'put', `defects/${defect.id}`, { expectedVersion: saved.version, materials: [{}] }).expect(400);
    expect((await read(defect.id).expect(200)).body).toMatchObject({ version: saved.version, materials: [expect.objectContaining({ id: saved.materials[0].id })] });
    expect((await send('leader', 'put', `defects/${defect.id}`, { expectedVersion: saved.version, materials: [] }).expect(200)).body.materials).toEqual([]);
  });

  it('preserves a populated legacy line submitted unchanged with missing required facts', async () => {
    const defect = await seedLegacySupplier(await create({ materials: [{ materialCode: 'LEGACY', supplierProfileId: profileId, sqeUserId: people.sqe.id }] }), supplierIds[0]!);
    const reviewed = (await send('sqe', 'put', `defects/${defect.id}/materials/${defect.materials[0]!.id}/verification`, {
      expectedVersion: defect.version, verification: 'NOT_MATERIAL',
    }).expect(200)).body as ProcessDefectDto;
    const saved = (await send('leader', 'put', `defects/${defect.id}`, {
      expectedVersion: reviewed.version, description: '补充台账信息', materials: reviewed.materials.map(editable),
    }).expect(200)).body;
    expect(saved.materials).toEqual(reviewed.materials);
    expect(saved.materialVerificationHistory).toEqual(reviewed.materialVerificationHistory);
    expect(saved.materials[0]).toMatchObject({ supplierOrganizationId: supplierIds[0], supplierProfileId: null, verification: 'NOT_MATERIAL' });
  });

  it('authorizes unchanged batch members and checks their versions without rewriting or auditing them', async () => {
    const material = { materialCode: 'CAS-MATERIAL', supplierProfileId: profileId, sqeUserId: people.sqe.id };
    const matching = await create({ responsibilityCategory: 'MATERIAL', materials: [material] });
    await send('sqe', 'put', `defects/${matching.id}/materials/${matching.materials[0]!.id}/verification`, {
      expectedVersion: matching.version, verification: 'CONFIRMED_DEFECT', verificationNotes: '保留复核',
    }).expect(200);
    const before = (await read(matching.id).expect(200)).body;
    const beforeAudit = await prisma.auditEvent.count({ where: { resourceType: 'ProcessDefect', resourceId: matching.id } });
    const other = await create();
    const compare = { defectId: matching.id, compareOnly: true, expectedVersion: before.version, fields: {} };
    const patch = { defectId: other.id, expectedVersion: other.version, fields: { responsibilityCategory: 'MATERIAL', materials: [material] } };

    await maintain('sqe', 'RESPONSIBILITY', [compare]).expect(403);
    await maintain('leader', 'ANALYSIS', [compare]).expect(400);
    await maintain('leader', 'RESPONSIBILITY', [{ ...compare, fields: patch.fields }]).expect(400);
    expect((await maintain('leader', 'RESPONSIBILITY', [compare]).expect(200)).body.items).toMatchObject([
      { id: matching.id, version: before.version, updatedAt: before.updatedAt, materials: before.materials },
    ]);
    const stale = await maintain('leader', 'RESPONSIBILITY', [patch, { ...compare, expectedVersion: before.version - 1 }]).expect(409);
    expect(stale.body.code).toBe('CONCURRENCY_CONFLICT');
    expect((await read(other.id).expect(200)).body).toMatchObject({ version: other.version, materials: [], updateRecords: [] });

    const key = randomUUID();
    const accepted = await maintain('leader', 'RESPONSIBILITY', [patch, compare], key).expect(200);
    expect(accepted.body.items).toMatchObject([
      { id: other.id, version: other.version + 1, materials: [material] },
      { id: matching.id, version: before.version, materials: before.materials },
    ]);
    expect((await maintain('leader', 'RESPONSIBILITY', [patch, compare], key).expect(200)).body).toEqual(accepted.body);
    expect((await read(matching.id).expect(200)).body).toEqual(before);
    expect(await prisma.auditEvent.count({ where: { resourceType: 'ProcessDefect', resourceId: matching.id } })).toBe(beforeAudit);
  });

  it('returns named updates for actual post-registration edits and ignores replay and automatic history', async () => {
    const manual = await create();
    const imported = await prisma.processDefect.create({ data: { organizationId, description: 'IMS preserved', sourceKind: 'IMS', externalSourceSystem: 'IMS', sourceReceiptId: randomUUID(), sourceRowIndex: 0, createdById: people.leader.id, updatedById: people.leader.id } });
    await prisma.auditEvent.create({ data: { organizationId, actorUserId: people.leader.id, resourceType: 'ProcessDefect', resourceId: imported.id, action: 'PROCESS_DEFECT_INGESTION_CREATED', outcome: 'SUCCESS', traceId: randomUUID() } });
    expect((await read(manual.id).expect(200)).body.updateRecords).toEqual([]);
    expect((await read(imported.id).expect(200)).body.updateRecords).toEqual([]);

    const sources = [manual, imported].map(row => ({ defectId: row.id, expectedVersion: row.version, fields: { analysisProgress: '已完成工序排查' } }));
    const key = randomUUID();
    await maintain('leader', 'ANALYSIS', sources, key).expect(200);
    await maintain('leader', 'ANALYSIS', sources, key).expect(200);
    await maintain('leader', 'ANALYSIS', sources.map(source => ({ ...source, expectedVersion: source.expectedVersion + 1 }))).expect(200);
    await send('leader', 'put', `defects/${manual.id}`, { expectedVersion: manual.version + 2, description: '修订不良事实' }).expect(200);

    const analysis = { id: expect.any(String), occurredAt: expect.any(String), content: '更新分析进度', actorName: '制程测试员' };
    expect((await read(manual.id).expect(200)).body.updateRecords).toEqual([
      { id: expect.any(String), occurredAt: expect.any(String), content: '更新不良描述', actorName: '制程测试员' }, analysis,
    ]);
    expect((await read(imported.id).expect(200)).body.updateRecords).toEqual([analysis]);
  });

  it('maintains each board independently on manual and IMS rows and records disposition changes', async () => {
    const manual = await create();
    const imported = await prisma.processDefect.create({ data: { organizationId, description: 'IMS preserved', sourceKind: 'IMS', externalSourceSystem: 'IMS', sourceReceiptId: randomUUID(), sourceRowIndex: 0, createdById: people.leader.id, updatedById: people.leader.id } });
    const sources = [manual, imported].map(row => ({ defectId: row.id, expectedVersion: row.version, fields: { dispositionPlan: 'SCRAP', dispositionCompletedAt: '2026-11-24T11:30:00+08:00' } }));
    const disposition = await maintain('leader', 'DISPOSITION', sources).expect(200);
    expect(disposition.body.items.map((item: ProcessDefectDto) => item.id)).toEqual([manual.id, imported.id]);
    expect(disposition.body.items[0]).toMatchObject({ dispositionPlan: 'SCRAP', dispositionCompletedAt: '2026-11-24T03:30:00.000Z', ledgerStatus: 'FOLLOWING', analysisProgress: null });
    await maintain('leader', 'CLOSURE', [{ defectId: manual.id, expectedVersion: 2, fields: { status: 'CLOSED' } }]).expect(403);
    await maintain('pqc', 'CLOSURE', [{ defectId: manual.id, expectedVersion: 2, fields: { status: 'CLOSED' } }]).expect(200);
    await maintain('leader', 'ANALYSIS', [{ defectId: manual.id, expectedVersion: 3, fields: { analysisProgress: 'Checked line', dispositionPlan: 'REWORK' } }]).expect(400);
    await maintain('leader', 'ANALYSIS', [{ defectId: manual.id, expectedVersion: 3, fields: { analysisProgress: 'Checked line' } }]).expect(200);
    const edited = await maintain('leader', 'DISPOSITION', [{ defectId: manual.id, expectedVersion: 4, fields: { dispositionProgress: 'Sorted units', dispositionCompletedAt: null } }]).expect(200);
    expect(edited.body.items[0]).toMatchObject({ id: manual.id, version: 5, description: manual.description, analysisProgress: 'Checked line', ledgerStatus: 'CLOSED', dispositionPlan: 'SCRAP', dispositionProgress: 'Sorted units', dispositionCompletedAt: null,
      dispositionHistory: [{ defectVersion: 2, dispositionPlan: 'SCRAP' }, { defectVersion: 5, dispositionPlan: 'SCRAP', dispositionProgress: 'Sorted units' }] });
    await maintain('pqc', 'CLOSURE', [{ defectId: manual.id, expectedVersion: 5, fields: { status: 'FOLLOWING', reason: '  ' } }]).expect(400);
    const reopened = await maintain('pqc', 'CLOSURE', [{ defectId: manual.id, expectedVersion: 5, fields: { status: 'FOLLOWING', reason: 'More work' } }]).expect(200);
    expect(reopened.body.items[0]).toMatchObject({ ledgerStatus: 'FOLLOWING', closedAt: null, dispositionPlan: 'SCRAP', analysisProgress: 'Checked line' });
  });

  it('resolves a changed material code only for a caller with material master read access', async () => {
    const materialCode = `N3-${randomUUID()}`;
    await prisma.materialMaster.create({ data: { organizationId, materialCode, materialName: 'Current master name', createdById: people.leader.id, updatedById: people.leader.id } });
    const defect = await create({ materials: [{ materialCode: 'OLD', materialName: 'Old name', materialBatch: 'Old batch', supplierProfileId: profileId }] });
    const materialId = defect.materials[0]!.id;
    const sources = (expectedVersion: number, code: string) => [{ defectId: defect.id, expectedVersion, fields: { materials: [{ id: materialId, materialCode: code }] } }];
    const unprivileged = await maintain('leader', 'RESPONSIBILITY', sources(1, materialCode)).expect(200);
    expect(unprivileged.body.items[0].materials[0]).toMatchObject({ id: materialId, materialCode, materialName: null, materialBatch: 'Old batch' });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'material-master:read' } });
    const grant = { roleId: people.pqc.roleId, permissionId: permission.id };
    await prisma.rolePermission.create({ data: grant });
    const unknown = await maintain('pqc', 'RESPONSIBILITY', sources(2, 'UNKNOWN')).expect(200);
    expect(unknown.body.items[0].materials[0]).toMatchObject({ id: materialId, materialCode: 'UNKNOWN', materialName: null });
    const changed = await maintain('pqc', 'RESPONSIBILITY', sources(3, materialCode)).expect(200);
    expect(changed.body.items[0].materials[0]).toMatchObject({ id: materialId, materialCode, materialName: 'Current master name', materialBatch: 'Old batch' });
    await prisma.rolePermission.deleteMany({ where: grant });
  });

  it('removes only explicitly identified materials and keeps past SQE review history', async () => {
    const defect = await create({ materials: [{ materialCode: 'REMOVE', supplierProfileId: profileId, sqeUserId: people.sqe.id }, { materialCode: 'KEEP', supplierProfileId: profileId }] });
    const [removed, retained] = defect.materials;
    await send('sqe', 'put', `defects/${defect.id}/materials/${removed!.id}/verification`, { expectedVersion: 1, verification: 'CONFIRMED_DEFECT' }).expect(200);
    const source = { defectId: defect.id, expectedVersion: 2, fields: { removedMaterialIds: [removed!.id] } };
    await maintain('leader', 'ANALYSIS', [source]).expect(400);
    await maintain('leader', 'RESPONSIBILITY', [{ ...source, fields: { ...source.fields, materials: [{ id: removed!.id, notes: 'Conflicting edit' }] } }]).expect(400);
    const key = randomUUID();
    const result = (await maintain('leader', 'RESPONSIBILITY', [source], key).expect(200)).body;
    expect(result.items[0]).toMatchObject({ version: 3, materials: [retained], materialVerificationHistory: [{ materialItemId: removed!.id, verification: 'CONFIRMED_DEFECT' }] });
    expect((await maintain('leader', 'RESPONSIBILITY', [source], key).expect(200)).body).toEqual(result);
  });

  it('groups multiple material edits and reviews by defect version and leaves unselected material alone', async () => {
    const defect = await create({ materials: [{ materialCode: 'A', notes: 'keep', supplierProfileId: profileId }, { materialCode: 'B', supplierProfileId: profileId }, { materialCode: 'C', supplierProfileId: profileId }] });
    const [first, second, untouched] = defect.materials;
    const changed = await maintain('leader', 'RESPONSIBILITY', [{ defectId: defect.id, expectedVersion: 1, fields: { responsibilityCategory: 'MATERIAL', materials: [
      { id: first!.id, sqeUserId: people.sqe.id }, { id: second!.id, sqeUserId: people.sqe.id, materialBatch: 'LOT-2' },
    ] } }]).expect(200);
    expect(changed.body.items[0]).toMatchObject({ version: 2, responsibilityCategory: 'MATERIAL', materials: [
      { id: first!.id, materialCode: 'A', notes: 'keep', sqeUserId: people.sqe.id }, { id: second!.id, materialCode: 'B', materialBatch: 'LOT-2', sqeUserId: people.sqe.id }, untouched,
    ] });
    await maintain('pqc', 'CLOSURE', [{ defectId: defect.id, expectedVersion: 2, fields: { status: 'CLOSED' } }]).expect(200);
    const sources = [{ defectId: defect.id, expectedVersion: 3, fields: { reviews: [
      { materialId: first!.id, verification: 'RETURN_ANALYSIS', verificationNotes: 'A notes' }, { materialId: second!.id, verification: 'NOT_MATERIAL' },
    ] } }];
    await maintain('otherSqe', 'MATERIAL_REVIEW', sources).expect(403);
    const key = randomUUID();
    const reviewed = await maintain('sqe', 'MATERIAL_REVIEW', sources, key).expect(200);
    expect(reviewed.body.items[0]).toMatchObject({ version: 4, ledgerStatus: 'CLOSED', materials: [
      { id: first!.id, verification: 'RETURN_ANALYSIS', verificationHistory: [{ defectVersion: 4 }] },
      { id: second!.id, verification: 'NOT_MATERIAL', verificationHistory: [{ defectVersion: 4 }] }, untouched,
    ] });
    expect((await maintain('sqe', 'MATERIAL_REVIEW', sources, key).expect(200)).body).toEqual(reviewed.body);
    await maintain('leader', 'RESPONSIBILITY', [{ defectId: defect.id, expectedVersion: 4, fields: { materials: [{ id: first!.id, sqeUserId: people.otherSqe.id }] } }]).expect(200);
    await maintain('sqe', 'MATERIAL_REVIEW', sources, key).expect(403);
  });

  it('rolls back earlier sources when a later source is stale, archived, foreign, or targets another defect’s material', async () => {
    const pair = [await create({ materials: [{ materialCode: 'A', supplierProfileId: profileId }] }), await create({ materials: [{ materialCode: 'B', supplierProfileId: profileId }] })].sort((first, second) => first.id.localeCompare(second.id));
    const [first, second] = pair as [ProcessDefectDto, ProcessDefectDto];
    const patch = { defectId: first.id, expectedVersion: 1, fields: { responsibilityCategory: 'MATERIAL' } };
    await maintain('leader', 'RESPONSIBILITY', [patch, { ...patch, defectId: second.id, expectedVersion: 2 }]).expect(409);
    await maintain('leader', 'RESPONSIBILITY', [patch, { ...patch, defectId: second.id, fields: { materials: [{ id: first.materials[0]!.id, materialBatch: 'wrong' }] } }]).expect(404);
    await prisma.processDefect.update({ where: { id: second.id }, data: { archivedAt: new Date() } });
    await maintain('leader', 'RESPONSIBILITY', [patch, { ...patch, defectId: second.id }]).expect(409);
    const foreign = await prisma.processDefect.create({ data: { organizationId: otherOrganizationId, sourceKind: 'IMS', externalSourceSystem: 'IMS', sourceReceiptId: randomUUID(), sourceRowIndex: 0, description: 'Foreign', createdById: people.leader.id, updatedById: people.leader.id } });
    await maintain('leader', 'RESPONSIBILITY', [patch, { ...patch, defectId: foreign.id }]).expect(404);
    expect((await read(first.id).expect(200)).body).toMatchObject({ version: 1, responsibilityCategory: null, classificationHistory: [] });
  });

  it('keeps legacy unknown facts nullable without inventing new registration results', async () => {
    const registered = await create({ materials: [] });
    expect(registered.materials).toEqual([]);
    const legacy = await prisma.processDefect.create({ data: { organizationId, description: '', createdById: people.leader.id, updatedById: people.leader.id } });
    const record = (await read(legacy.id).expect(200)).body as ProcessDefectDto;
    expect(record).toMatchObject({ responsibilityCategory: null, defectTypeCode: null, defectQuantity: null, occurredAt: null, ledgerStatus: 'FOLLOWING', sourceKind: 'MANUAL', materials: [] });
    expect(record.issues).toEqual(expect.arrayContaining(['DESCRIPTION_EMPTY', 'DEFECT_QUANTITY_UNKNOWN', 'OCCURRED_AT_UNKNOWN', 'DEFECT_TYPE_UNKNOWN']));
    const stored = await prisma.processDefect.findUniqueOrThrow({ where: { id: record.id } });
    expect(stored).toMatchObject({ responsibilityCategory: null, defectQuantity: null, occurredAt: null, description: '' });
    const reference = await ledger.sourceReference(actor(), record.id);
    const locked = await prisma.$transaction(tx => ledger.lockAndResolve(tx, reference));
    expect(locked?.sourceSnapshot).toEqual(reference.sourceSnapshot);
    expect(reference.sourceSnapshot).toMatchObject({ materials: [], defectQuantity: null, occurredAt: null, traceCode: null, analysisProgress: null });
  });

  it('retains same-operation/same-barcode records, only warns, and does not contaminate source snapshots with live duplicate hints', async () => {
    const traceCode = randomUUID();
    const first = await create({ operationCode: 'OP-A', traceCode });
    const reference = await ledger.sourceReference(actor(), first.id);
    const second = await create({ operationCode: 'OP-A', traceCode, description: 'Another real issue' });
    const otherOperation = await create({ operationCode: 'OP-B', traceCode });
    expect(second.id).not.toBe(first.id);
    expect(second.issues).toContain('SAME_OPERATION_TRACE_DUPLICATE');
    expect(otherOperation.issues).not.toContain('SAME_OPERATION_TRACE_DUPLICATE');
    expect((await read(first.id).expect(200)).body.duplicateCount).toBe(1);
    const locked = await prisma.$transaction(tx => ledger.lockAndResolve(tx, reference));
    expect(locked?.sourceSnapshot).toEqual(reference.sourceSnapshot);
    const list = await request(app.getHttpServer()).get(`/api/v1/process-quality/defects?traceCode=${traceCode}`).set('Cookie', people.leader.cookie).expect(200);
    expect(list.body.total).toBe(3);
  });

  it('requires separate close permission and a reopen reason; closed maintenance does not reopen or alter a linked problem', async () => {
    const record = await create();
    const reference = await ledger.sourceReference(actor(), record.id);
    const problem = await prisma.problemIndex.create({ data: { organizationId, reportNumber: `N3-${randomUUID()}`, domainCode: 'process-quality', problemType: 'PROCESS_DEFECT', sourceType: 'process-defect', sourceId: record.id, severity: 'MEDIUM', createdById: people.pqc.id } });
    const link = await prisma.domainSourceIssueLink.create({ data: { organizationId, problemIndexId: problem.id, ...reference } });
    await send('leader', 'put', `defects/${record.id}/close`, { expectedVersion: 1 }).expect(403);
    expect((await read(record.id).expect(200)).body).toMatchObject({ version: 1, ledgerStatus: 'FOLLOWING', ledgerHistory: [] });
    const key = randomUUID();
    const closed = (await send('pqc', 'put', `defects/${record.id}/close`, { expectedVersion: 1 }, key).expect(200)).body;
    expect(closed).toMatchObject({ version: 2, ledgerStatus: 'CLOSED', closedById: people.pqc.id });
    expect((await send('pqc', 'put', `defects/${record.id}/close`, { expectedVersion: 1 }, key).expect(200)).body).toEqual(closed);
    const supplemented = (await send('leader', 'put', `defects/${record.id}`, { expectedVersion: 2, description: 'Late source detail', analysisProgress: 'Analysis continues' }).expect(200)).body;
    expect(supplemented).toMatchObject({ version: 3, ledgerStatus: 'CLOSED', closedById: people.pqc.id });
    await send('pqc', 'put', `defects/${record.id}/reopen`, { expectedVersion: 3, reason: ' ' }).expect(400);
    await send('leader', 'put', `defects/${record.id}/reopen`, { expectedVersion: 3, reason: 'Need follow-up' }).expect(403);
    const reopened = (await send('pqc', 'put', `defects/${record.id}/reopen`, { expectedVersion: 3, reason: 'Need follow-up' }).expect(200)).body;
    expect(reopened).toMatchObject({ ledgerStatus: 'FOLLOWING', closedAt: null, closedById: null, version: 4 });
    const reclosed = (await send('pqc', 'put', `defects/${record.id}/close`, { expectedVersion: 4 }).expect(200)).body;
    expect(reclosed.ledgerHistory.map((entry: { toStatus: string }) => entry.toStatus)).toEqual(['CLOSED', 'FOLLOWING', 'CLOSED']);
    expect(reclosed.ledgerHistory[1]).toMatchObject({ actorUserId: people.pqc.id, reason: 'Need follow-up' });
    expect(await prisma.problemIndex.findUniqueOrThrow({ where: { id: problem.id } })).toEqual(problem);
    expect(await prisma.domainSourceIssueLink.findUniqueOrThrow({ where: { id: link.id } })).toEqual(link);
  });

  it('classifies an explicit CAS selection atomically, records corrections and leaves different materials alone', async () => {
    const records = [await create({ materials: [{ materialCode: 'M-A', supplierProfileId: profileId }] }), await create({ materials: [{ materialCode: 'M-B', supplierProfileId: profileId }] })];
    const sources = records.map(record => ({ defectId: record.id, expectedVersion: 1 }));
    const key = randomUUID();
    const first = (await send('leader', 'put', 'defects/classification', { sources, responsibilityCategory: 'FALSE_POSITIVE' }, key).expect(200)).body;
    expect(first.items.map((record: ProcessDefectDto) => record.materials[0]?.materialCode)).toEqual(['M-A', 'M-B']);
    expect(first.items.every((record: ProcessDefectDto) => record.responsibilityCategory === 'FALSE_POSITIVE' && record.ledgerStatus === 'FOLLOWING')).toBe(true);
    expect((await send('leader', 'put', 'defects/classification', { sources, responsibilityCategory: 'FALSE_POSITIVE' }, key).expect(200)).body).toEqual(first);
    const successCount = await prisma.auditEvent.count({ where: { organizationId, action: 'PROCESS_DEFECT_CLASSIFIED', outcome: 'SUCCESS' } });
    await send('leader', 'put', 'defects/classification', { sources: [{ ...sources[0], expectedVersion: 2 }, { ...sources[1], expectedVersion: 1 }], responsibilityCategory: 'PROCESS' }).expect(409);
    for (const record of records) expect((await read(record.id).expect(200)).body).toMatchObject({ version: 2, responsibilityCategory: 'FALSE_POSITIVE', classificationHistory: [{ previousCategory: null, category: 'FALSE_POSITIVE', actorUserId: people.leader.id }] });
    expect(await prisma.auditEvent.count({ where: { organizationId, action: 'PROCESS_DEFECT_CLASSIFIED', outcome: 'SUCCESS' } })).toBe(successCount);
    const corrected = (await send('leader', 'put', `defects/${records[0]!.id}/classification`, { expectedVersion: 2, responsibilityCategory: null }).expect(200)).body.items[0];
    expect(corrected.classificationHistory[1]).toMatchObject({ previousCategory: 'FALSE_POSITIVE', category: null, actorUserId: people.leader.id });
    await send('leader', 'put', 'defects/classification', { sources: [...sources, ...sources], responsibilityCategory: 'MATERIAL' }).expect(400);
  });

  it('preserves multi-material ownership and SQE selection when suppliers change; legacy input changes only the first item', async () => {
    const record = await create({ materials: [{ materialCode: 'M-A', materialName: 'Part A', materialBatch: 'MAT-BATCH-A', supplierProfileId: profileId, sqeUserId: people.sqe.id }, { materialCode: 'M-B', supplierProfileId: profileId, sqeUserId: people.otherSqe.id }] });
    expect(record.materialCode).toBe('M-A');
    expect(record.materials).toHaveLength(2);
    const changed = (await send('leader', 'put', `defects/${record.id}`, { expectedVersion: 1, materials: record.materials.map((item, i) => ({ id: item.id, ...(i === 0 ? { supplierProfileId: secondProfileId } : {}) })) }).expect(200)).body;
    expect(changed.materials[0]).toMatchObject({ supplierProfileId: secondProfileId, sqeUserId: people.sqe.id, materialBatch: 'MAT-BATCH-A' });
    const legacy = (await send('leader', 'put', `defects/${record.id}`, { expectedVersion: 2, materialCode: 'LEGACY-FIRST' }).expect(200)).body;
    expect(legacy.materials.map((item: ProcessDefectDto['materials'][number]) => item.materialCode)).toEqual(['LEGACY-FIRST', 'M-B']);
    expect(legacy.materials[0].sqeUserId).toBe(people.sqe.id);
    expect((await prisma.processDefect.findUniqueOrThrow({ where: { id: record.id } })).materialCode).toBe('LEGACY-FIRST');
    const filtered = await request(app.getHttpServer()).get('/api/v1/process-quality/defects?materialCode=M-B').set('Cookie', people.leader.cookie).expect(200);
    expect(filtered.body.items.some((item: ProcessDefectDto) => item.id === record.id)).toBe(true);
    const reference = await ledger.sourceReference(actor(), record.id);
    expect(reference.sourceSnapshot.materials).toHaveLength(2);
    const validFacts = { occurredAt: '2026-11-16T00:30:00Z', factoryCode: 'FACTORY_1', productCode: 'N3-PRODUCT', traceCode: randomUUID(), description: '材料校验' };
    await send('leader', 'post', 'defects', { ...validFacts, materials: [{ supplierProfileId: foreignProfileId }] }).expect(404);
    await send('leader', 'post', 'defects', { ...validFacts, materials: [{ sqeUserId: people.leader.id }] }).expect(400);
  });

  it('allows only the designated currently effective SQE to record one of four independent conclusions, with history and no early tasks', async () => {
    const record = await create({ responsibilityCategory: 'PROCESS', materials: [{ materialCode: 'M-A', supplierProfileId: profileId, sqeUserId: people.sqe.id }, { materialCode: 'M-B', supplierProfileId: profileId, sqeUserId: people.otherSqe.id }] });
    const materialId = record.materials[0]!.id;
    const path = `defects/${record.id}/materials/${materialId}/verification`;
    const taskCount = await prisma.workflowTask.count({ where: { organizationId } });
    const outboxCount = await prisma.outboxEvent.count({ where: { payload: { path: ['organizationId'], equals: organizationId } } });
    const notificationCount = await prisma.notification.count({ where: { organizationId } });
    await send('leader', 'put', path, { expectedVersion: 1, verification: 'CONFIRMED_DEFECT' }).expect(403);
    await send('otherSqe', 'put', path, { expectedVersion: 1, verification: 'CONFIRMED_DEFECT' }).expect(403);
    let expectedVersion = 1;
    let current = record;
    let lastKey = '';
    for (const verification of ['CONFIRMED_DEFECT', 'NOT_MATERIAL', 'NEGOTIATED', 'RETURN_ANALYSIS']) {
      lastKey = randomUUID();
      current = (await send('sqe', 'put', path, { expectedVersion, verification, verificationNotes: `SQE ${verification}` }, lastKey).expect(200)).body;
      expect(current).toMatchObject({ responsibilityCategory: 'PROCESS', ledgerStatus: 'FOLLOWING', version: expectedVersion + 1 });
      expect(current.materials[1]).toMatchObject({ verification: 'UNREVIEWED', verificationHistory: [] });
      expect(current.issues.some(issue => /VERIFICATION.*DIFFER|SQE.*DIFFER/.test(issue))).toBe(false);
      expectedVersion += 1;
    }
    expect(current.materials[0]?.verificationHistory).toHaveLength(4);
    expect(await prisma.workflowTask.count({ where: { organizationId } })).toBe(taskCount);
    expect(await prisma.outboxEvent.count({ where: { payload: { path: ['organizationId'], equals: organizationId } } })).toBe(outboxCount);
    expect(await prisma.notification.count({ where: { organizationId } })).toBe(notificationCount);
    const removed = (await send('leader', 'put', `defects/${record.id}`, { expectedVersion, materials: [editable(current.materials[1]!)] }).expect(200)).body;
    expect(removed.materialVerificationHistory).toHaveLength(4);
    expect(removed.materialVerificationHistory[0].materialSnapshot).toMatchObject({ id: materialId, materialCode: 'M-A', sqeUserId: people.sqe.id });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:materials:review' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: people.sqe.roleId, permissionId: permission.id } } });
    await send('sqe', 'put', path, { expectedVersion: expectedVersion - 1, verification: 'RETURN_ANALYSIS', verificationNotes: 'SQE RETURN_ANALYSIS' }, lastKey).expect(403);
    const options = await request(app.getHttpServer()).get('/api/v1/process-quality/defects/material-sqes').set('Cookie', people.leader.cookie).expect(200);
    expect(options.body.items.some((item: { id: string }) => item.id === people.sqe.id)).toBe(false);
    await prisma.rolePermission.create({ data: { roleId: people.sqe.roleId, permissionId: permission.id } });
  });

  it('accepts an uppercase materialId URL and keeps review history and audit idempotent', async () => {
    const record = await create({ materials: [{ materialCode: 'UPPERCASE-URL', supplierProfileId: profileId, sqeUserId: people.sqe.id }] });
    const materialId = record.materials[0]!.id;
    const upperMaterialId = materialId.toUpperCase();
    expect(upperMaterialId).not.toBe(materialId);
    const key = randomUUID();
    const body = { expectedVersion: 1, verification: 'CONFIRMED_DEFECT', verificationNotes: 'Uppercase URL review' };
    const reviewed: ProcessDefectDto = (await send('sqe', 'put', `defects/${record.id}/materials/${upperMaterialId}/verification`, body, key).expect(200)).body;
    expect(reviewed).toMatchObject({ version: 2, materials: [{ id: materialId, verification: body.verification, verificationNotes: body.verificationNotes, verifiedById: people.sqe.id }] });
    expect(reviewed.materialVerificationHistory).toHaveLength(1);
    expect(reviewed.materialVerificationHistory[0]).toMatchObject({ actorUserId: people.sqe.id, defectVersion: 2, materialSnapshot: { id: materialId, materialCode: 'UPPERCASE-URL', sqeUserId: people.sqe.id } });
    expect((await send('sqe', 'put', `defects/${record.id}/materials/${materialId}/verification`, body, key).expect(200)).body).toEqual(reviewed);
    expect((await read(record.id).expect(200)).body).toMatchObject(reviewed);
    expect(await prisma.auditEvent.count({ where: { organizationId, resourceId: record.id, action: 'PROCESS_DEFECT_MATERIAL_VERIFIED', outcome: 'SUCCESS' } })).toBe(1);
  });

  it.each([
    ['materialCode', 'M-B', 'CONFIRMED_DEFECT'], ['materialName', 'Part B', 'NOT_MATERIAL'],
    ['supplierOrganizationId', supplierIds[1], 'NEGOTIATED'], ['materialBatch', 'Y', 'RETURN_ANALYSIS'],
  ] as const)('clears only the current review when %s changes, preserving all historical reviewed facts', async (field, value, verification) => {
    const record = await seedLegacySupplier(await create({ materials: [{ materialCode: 'M-A', materialName: 'Part A', supplierProfileId: profileId, materialBatch: 'X', sqeUserId: people.sqe.id }] }), supplierIds[0]!);
    const materialId = record.materials[0]!.id;
    const reviewed: ProcessDefectDto = (await send('sqe', 'put', `defects/${record.id}/materials/${materialId}/verification`, { expectedVersion: 1, verification, verificationNotes: 'Conclusion for A/X only' }).expect(200)).body;
    const history = await prisma.$queryRaw`SELECT * FROM process_defect_material_verifications WHERE defect_id = ${record.id}::uuid`;
    const reference = await ledger.sourceReference(actor(), record.id);
    const taskCount = await prisma.workflowTask.count({ where: { organizationId } });
    const notificationCount = await prisma.notification.count({ where: { organizationId } });
    const outboxCount = await prisma.outboxEvent.count({ where: { payload: { path: ['organizationId'], equals: organizationId } } });
    const updated: ProcessDefectDto = (await send('leader', 'put', `defects/${record.id}`, { expectedVersion: 2, materials: [{ id: materialId, [field]: value }] }).expect(200)).body;
    expect(updated.materials[0]).toMatchObject({ id: materialId, [field]: value, verification: 'UNREVIEWED', verificationNotes: null, verifiedById: null, verifiedAt: null, sqeUserId: people.sqe.id });
    expect(updated.materialVerificationHistory).toEqual(reviewed.materialVerificationHistory);
    expect(updated.materials[0]!.verificationHistory).toEqual(reviewed.materials[0]!.verificationHistory);
    expect(await prisma.$queryRaw`SELECT * FROM process_defect_material_verifications WHERE defect_id = ${record.id}::uuid`).toEqual(history);
    expect(reference.sourceSnapshot.materials).toMatchObject([{ materialCode: 'M-A', materialBatch: 'X', supplierOrganizationId: supplierIds[0], verification }]);
    const nextReference = await ledger.sourceReference(actor(), record.id);
    expect(nextReference.sourceSnapshot.materials).toMatchObject([{ verification: 'UNREVIEWED', [field]: value }]);
    expect(nextReference.sourceSnapshot.materialVerificationHistory).toEqual(reference.sourceSnapshot.materialVerificationHistory);
    expect(await prisma.workflowTask.count({ where: { organizationId } })).toBe(taskCount);
    expect(await prisma.notification.count({ where: { organizationId } })).toBe(notificationCount);
    expect(await prisma.outboxEvent.count({ where: { payload: { path: ['organizationId'], equals: organizationId } } })).toBe(outboxCount);
    expect((await send('pqc', 'put', `defects/${record.id}/close`, { expectedVersion: 3 }).expect(200)).body.ledgerStatus).toBe('CLOSED');
  });

  it('clears the current review when unbound supplier profile A becomes B, without rewriting history or linked snapshots', async () => {
    const record = await create({ materials: [
      { materialCode: 'M-A', materialName: 'Part A', materialBatch: 'X', supplierProfileId: profileId, sqeUserId: people.sqe.id },
      { materialCode: 'OTHER', supplierProfileId: profileId },
    ] });
    const materialId = record.materials[0]!.id;
    const reviewed: ProcessDefectDto = (await send('sqe', 'put', `defects/${record.id}/materials/${materialId}/verification`, {
      expectedVersion: 1, verification: 'CONFIRMED_DEFECT', verificationNotes: 'Only supplier profile A was reviewed',
    }).expect(200)).body;
    expect(reviewed.materials[0]).toMatchObject({ supplierProfileId: profileId, supplierOrganizationId: null, verifiedById: people.sqe.id, verifiedAt: expect.any(String) });
    const history = await prisma.$queryRaw`SELECT * FROM process_defect_material_verifications WHERE defect_id = ${record.id}::uuid`;
    const reference = await ledger.sourceReference(actor(), record.id);
    const problem = await prisma.problemIndex.create({ data: { organizationId, reportNumber: `N3-${randomUUID()}`, domainCode: 'process-quality', problemType: 'PROCESS_DEFECT', sourceType: 'process-defect', sourceId: record.id, severity: 'MEDIUM', createdById: people.pqc.id } });
    const link = await prisma.domainSourceIssueLink.create({ data: { organizationId, problemIndexId: problem.id, ...reference } });
    const taskCount = await prisma.workflowTask.count({ where: { organizationId } });
    const notificationCount = await prisma.notification.count({ where: { organizationId } });
    const outboxCount = await prisma.outboxEvent.count({ where: { payload: { path: ['organizationId'], equals: organizationId } } });

    const updated: ProcessDefectDto = (await send('leader', 'put', `defects/${record.id}`, { expectedVersion: 2, materials: [
      { id: materialId, supplierProfileId: secondProfileId }, { id: record.materials[1]!.id },
    ] }).expect(200)).body;
    expect(updated.materials[0]).toMatchObject({ id: materialId, materialCode: 'M-A', materialName: 'Part A', materialBatch: 'X',
      supplierProfileId: secondProfileId, supplierOrganizationId: null, sqeUserId: people.sqe.id,
      verification: 'UNREVIEWED', verificationNotes: null, verifiedById: null, verifiedAt: null });
    expect(updated.materials[1]).toEqual(reviewed.materials[1]);
    expect(updated.materialVerificationHistory).toEqual(reviewed.materialVerificationHistory);
    expect(updated.materials[0]!.verificationHistory).toEqual(reviewed.materials[0]!.verificationHistory);
    expect(updated.materialVerificationHistory[0]!.materialSnapshot).toMatchObject({ supplierProfileId: profileId, supplierOrganizationId: null });
    expect(await prisma.$queryRaw`SELECT * FROM process_defect_material_verifications WHERE defect_id = ${record.id}::uuid`).toEqual(history);
    expect(await prisma.domainSourceIssueLink.findUniqueOrThrow({ where: { id: link.id } })).toEqual(link);
    const nextReference = await ledger.sourceReference(actor(), record.id);
    expect(reference.sourceSnapshot.materials).toMatchObject([{ supplierProfileId: profileId, supplierOrganizationId: null, verification: 'CONFIRMED_DEFECT' }, {}]);
    expect(nextReference.sourceSnapshot.materials).toMatchObject([{ supplierProfileId: secondProfileId, supplierOrganizationId: null, verification: 'UNREVIEWED' }, {}]);
    expect(nextReference.sourceSnapshot.materialVerificationHistory).toEqual(reference.sourceSnapshot.materialVerificationHistory);
    expect(await prisma.workflowTask.count({ where: { organizationId } })).toBe(taskCount);
    expect(await prisma.notification.count({ where: { organizationId } })).toBe(notificationCount);
    expect(await prisma.outboxEvent.count({ where: { payload: { path: ['organizationId'], equals: organizationId } } })).toBe(outboxCount);
    expect((await send('pqc', 'put', `defects/${record.id}/close`, { expectedVersion: 3 }).expect(200)).body.ledgerStatus).toBe('CLOSED');
  });

  it('keeps the review when a supplier mapping is completed or a profile is replaced for the same real supplier organization', async () => {
    const profile = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: organizationId, businessCode: randomUUID(), displayName: 'Mapping completed after review' } });
    const record = await create({ materials: [{ materialCode: 'M-A', supplierProfileId: profile.id, sqeUserId: people.sqe.id }] });
    const materialId = record.materials[0]!.id;
    const reviewed: ProcessDefectDto = (await send('sqe', 'put', `defects/${record.id}/materials/${materialId}/verification`, {
      expectedVersion: 1, verification: 'NOT_MATERIAL', verificationNotes: 'Same supplier identity',
    }).expect(200)).body;
    await prisma.supplierBusinessProfile.update({ where: { id: profile.id }, data: { supplierOrganizationId: supplierIds[0] } });
    const mapped: ProcessDefectDto = (await send('leader', 'put', `defects/${record.id}`, { expectedVersion: 2, materials: [
      { id: materialId, supplierOrganizationId: supplierIds[0], supplierProfileId: profile.id },
    ] }).expect(200)).body;
    expect(mapped.materials[0]).toEqual({ ...reviewed.materials[0], supplierOrganizationId: supplierIds[0] });

    await prisma.supplierBusinessProfile.update({ where: { id: profile.id }, data: { supplierOrganizationId: null } });
    const alias = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: organizationId, businessCode: randomUUID(), displayName: 'Same real supplier', supplierOrganizationId: supplierIds[0] } });
    const remapped: ProcessDefectDto = (await send('leader', 'put', `defects/${record.id}`, { expectedVersion: 3, materials: [
      { id: materialId, supplierOrganizationId: supplierIds[0], supplierProfileId: alias.id },
    ] }).expect(200)).body;
    expect(remapped.materials[0]).toEqual({ ...mapped.materials[0], supplierProfileId: alias.id });
    expect(remapped.materialVerificationHistory).toEqual(reviewed.materialVerificationHistory);
    expect((await read(record.id).expect(200)).body.materials).toEqual(remapped.materials);
  });

  it('keeps conclusions through reordering, notes, SQE reassignment and UUID casing without rewriting old snapshots', async () => {
    const record = await seedLegacySupplier(await create({ materials: [{ materialCode: 'M-A', supplierProfileId: profileId, sqeUserId: people.sqe.id }, { materialCode: 'OTHER', supplierProfileId: profileId }] }), supplierIds[0]!);
    const materialId = record.materials[0]!.id;
    const reviewed: ProcessDefectDto = (await send('sqe', 'put', `defects/${record.id}/materials/${materialId}/verification`, { expectedVersion: 1, verification: 'CONFIRMED_DEFECT', verificationNotes: 'Original conclusion' }).expect(200)).body;
    const updated: ProcessDefectDto = (await send('leader', 'put', `defects/${record.id}`, { expectedVersion: 2, materials: [
      { id: record.materials[1]!.id.toUpperCase() },
      { id: materialId.toUpperCase(), supplierOrganizationId: supplierIds[0]!.toUpperCase(), notes: 'More context', sqeUserId: people.otherSqe.id.toUpperCase() },
    ] }).expect(200)).body;
    expect(updated.materials.map(item => item.id)).toEqual([record.materials[1]!.id, materialId]);
    expect(updated.materials[1]).toMatchObject({ verification: 'CONFIRMED_DEFECT', verificationNotes: 'Original conclusion', verifiedById: people.sqe.id, verifiedAt: reviewed.materials[0]!.verifiedAt, sqeUserId: people.otherSqe.id, notes: 'More context' });
    expect(updated.materialVerificationHistory).toEqual(reviewed.materialVerificationHistory);
    expect(updated.materialVerificationHistory[0]!.materialSnapshot.sqeUserId).toBe(people.sqe.id);
    const legacy: ProcessDefectDto = (await send('leader', 'put', `defects/${record.id}`, { expectedVersion: 3, materialCode: 'OTHER-UPDATED' }).expect(200)).body;
    expect(legacy.materials[1]).toEqual(updated.materials[1]);
  });

  it('also clears a reviewed first item through the legacy material projection and does not guess unknown identity facts', async () => {
    const record = await seedLegacySupplier(await create({ materials: [{ materialCode: 'M-A', materialName: null, supplierProfileId: profileId, sqeUserId: people.sqe.id }] }), null);
    const materialId = record.materials[0]!.id;
    const reviewed = (await send('sqe', 'put', `defects/${record.id}/materials/${materialId}/verification`, { expectedVersion: 1, verification: 'NOT_MATERIAL' }).expect(200)).body;
    const updated = (await send('leader', 'put', `defects/${record.id}`, { expectedVersion: 2, materialCode: 'M-B' }).expect(200)).body;
    expect(updated.materials[0]).toMatchObject({ verification: 'UNREVIEWED', verificationNotes: null, verifiedById: null, verifiedAt: null, materialName: null });
    expect(updated.materialVerificationHistory).toEqual(reviewed.materialVerificationHistory);
    await send('sqe', 'put', `defects/${record.id}/materials/${materialId}/verification`, { expectedVersion: 3, verification: 'NEGOTIATED' }).expect(200);
    const known = (await send('leader', 'put', `defects/${record.id}`, { expectedVersion: 4, materials: [{ id: materialId, materialName: 'Now known' }] }).expect(200)).body;
    expect(known.materials[0]).toMatchObject({ verification: 'UNREVIEWED', verifiedById: null, verifiedAt: null, materialName: 'Now known' });
    expect(known.materialVerificationHistory).toHaveLength(2);
    expect(known.materialVerificationHistory[1].materialSnapshot).toMatchObject({ materialCode: 'M-B', materialName: null });
  });

  it('lists marker-only internal material reviewers consistently with assignment eligibility and removes revoked candidates', async () => {
    const search = `marker-sqe-${randomUUID()}`;
    const marker = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
    const candidates = await Promise.all([
      { organizationId, status: 'ACTIVE' as const, suffix: 'eligible' },
      { organizationId, status: 'DISABLED' as const, suffix: 'disabled' },
      { organizationId: otherOrganizationId, status: 'ACTIVE' as const, suffix: 'foreign' },
    ].map(async input => {
      const user = await prisma.user.create({ data: { organizationId: input.organizationId, username: `${search}-${input.suffix}`, passwordHash: 'test-only', accountType: 'INTERNAL', status: input.status } });
      const role = await prisma.role.create({ data: { organizationId: input.organizationId, code: randomUUID(), name: 'Explicit platform candidate', permissions: { create: { permissionId: marker.id } } } });
      await prisma.userRole.create({ data: { organizationId: input.organizationId, userId: user.id, roleId: role.id } });
      return { user, role };
    }));
    try {
      const options = await ledger.materialSqes(actor(), { page: 1, pageSize: 1, search });
      expect(options.total).toBe(1);
      expect(options.items.map(item => item.id)).toEqual([candidates[0]!.user.id]);
      const record = await create({ materials: [{ materialCode: 'MARKER-CANDIDATE', supplierProfileId: profileId, sqeUserId: candidates[0]!.user.id }] });
      expect(record.materials[0]!.sqeUserId).toBe(candidates[0]!.user.id);
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: candidates[0]!.role.id, permissionId: marker.id } } });
      expect(await ledger.materialSqes(actor(), { page: 1, pageSize: 1, search })).toMatchObject({ items: [], total: 0 });
      await send('leader', 'post', 'defects', { occurredAt: '2026-11-16T00:30:00Z', factoryCode: 'FACTORY_1', productCode: 'N3-PRODUCT', traceCode: randomUUID(), description: '撤销权限校验', materials: [{ materialCode: 'REVOKED-MARKER', supplierProfileId: profileId, sqeUserId: candidates[0]!.user.id }] }).expect(400);
    } finally {
      await prisma.rolePermission.deleteMany({ where: { roleId: { in: candidates.map(item => item.role.id) }, permissionId: marker.id } });
    }
  });

  it('keeps an unconfirmed legacy project readable without manufacturing current mapping history', async () => {
    const legacy = await prisma.processDefect.create({ data: { organizationId, description: 'Legacy project', productCode: `UNMAPPED-${randomUUID()}`, projectCode: 'MANUAL-PROJECT', createdById: people.leader.id, updatedById: people.leader.id } });
    const record = (await read(legacy.id).expect(200)).body as ProcessDefectDto;
    expect(record.projectCode).toBe('MANUAL-PROJECT');
    expect(record.componentProject).toBeNull();
    expect(record.issues).toContain('HISTORICAL_ASSOCIATION_UNCONFIRMED');
    expect((await read(record.id).expect(200)).body.projectCode).toBe('MANUAL-PROJECT');
  });

  it('rejects forged status, CSRF, foreign scope and revoked sessions instead of hiding failures', async () => {
    const record = await create();
    await send('leader', 'put', `defects/${record.id}`, { expectedVersion: 1, ledgerStatus: 'CLOSED' }).expect(400);
    await request(app.getHttpServer()).put(`/api/v1/process-quality/defects/${record.id}/close`).set('Cookie', people.pqc.cookie).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1 }).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/process-quality/defects?organizationId=${otherOrganizationId}`).set('Cookie', people.leader.cookie).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/process-quality/defects/${record.id}`).expect(401);
    await prisma.session.update({ where: { id: people.leader.sessionId }, data: { revokedAt: new Date() } });
    await expect(ledger.detail(actor(), record.id)).rejects.toMatchObject({ status: 401 });
    await send('leader', 'put', `defects/${record.id}`, { expectedVersion: 1, description: 'Revoked write' }).expect(401);
    expect((await prisma.processDefect.findUniqueOrThrow({ where: { id: record.id } })).version).toBe(1);
  });
});
