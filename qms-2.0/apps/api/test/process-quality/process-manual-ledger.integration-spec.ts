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
      await prisma.user.create({ data: { id: person.id, organizationId, username: `N3-${name}-${person.id.slice(0, 8)}`, passwordHash: 'test-only', accountType: 'INTERNAL' } });
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

  function send(who: keyof typeof people, method: 'post' | 'put', path: string, body: object, key: string = randomUUID()) {
    return request(app.getHttpServer())[method](`/api/v1/process-quality/${path}`).set('Cookie', people[who].cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }
  function read(id: string) { return request(app.getHttpServer()).get(`/api/v1/process-quality/defects/${id}`).set('Cookie', people.leader.cookie); }
  async function create(body: object = {}): Promise<ProcessDefectDto> { return (await send('leader', 'post', 'defects', body).expect(201)).body; }
  const actor = () => ({ id: people.leader.id, organizationId, accountType: 'INTERNAL' as const, sessionId: people.leader.sessionId });
  function editable(material: ProcessDefectDto['materials'][number]): ProcessDefectMaterialInputDto {
    const { id, materialCode, materialName, supplierOrganizationId, supplierProfileId, materialBatch, sqeUserId, notes } = material;
    return { id, materialCode, materialName, supplierOrganizationId, supplierProfileId, materialBatch, sqeUserId, notes };
  }

  it('keeps unknown facts nullable and empty material form groups out of the database', async () => {
    const record = await create({ description: '', materials: [{}, { materialCode: '   ' }] });
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
    const records = [await create({ materials: [{ materialCode: 'M-A' }] }), await create({ materials: [{ materialCode: 'M-B' }] })];
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
    const record = await create({ materials: [{ materialCode: 'M-A', materialName: 'Part A', materialBatch: 'MAT-BATCH-A', supplierProfileId: profileId, sqeUserId: people.sqe.id }, { materialCode: 'M-B', sqeUserId: people.otherSqe.id }] });
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
    await send('leader', 'post', 'defects', { materials: [{ supplierProfileId: foreignProfileId }] }).expect(404);
    await send('leader', 'post', 'defects', { materials: [{ sqeUserId: people.leader.id }] }).expect(400);
  });

  it('allows only the designated currently effective SQE to record one of four independent conclusions, with history and no early tasks', async () => {
    const record = await create({ responsibilityCategory: 'PROCESS', materials: [{ materialCode: 'M-A', sqeUserId: people.sqe.id }, { materialCode: 'M-B', sqeUserId: people.otherSqe.id }] });
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
    const record = await create({ materials: [{ materialCode: 'UPPERCASE-URL', sqeUserId: people.sqe.id }] });
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
    const record = await create({ materials: [{ materialCode: 'M-A', materialName: 'Part A', supplierOrganizationId: supplierIds[0], materialBatch: 'X', sqeUserId: people.sqe.id }] });
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
      { materialCode: 'OTHER' },
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
    const record = await create({ materials: [{ materialCode: 'M-A', supplierOrganizationId: supplierIds[0], sqeUserId: people.sqe.id }, { materialCode: 'OTHER' }] });
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
    const record = await create({ materials: [{ materialCode: 'M-A', materialName: null, sqeUserId: people.sqe.id }] });
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

  it('resolves an unmapped component without configuration read permission or overwriting the manual project', async () => {
    const record = await create({ productCode: `UNMAPPED-${randomUUID()}`, projectCode: 'MANUAL-PROJECT' });
    expect(record.projectCode).toBe('MANUAL-PROJECT');
    expect(record.componentProject).toMatchObject({ outcome: 'unmapped', issues: expect.arrayContaining(['MAPPING_NOT_FOUND']) });
    expect(record.issues).toContain('MAPPING_NOT_FOUND');
    expect((await read(record.id).expect(200)).body.componentProject.componentCode).toBe(record.productCode);
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
