import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { ProcessDefectIngestionAdapter } from '../../src/modules/process-quality/process-defect-ingestion.adapter.js';
import { ProcessDefectCompletionService } from '../../src/modules/process-quality/process-defect-completion.service.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';

if (!process.env.DATABASE_URL || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(process.env.DATABASE_URL).port === '55440') throw new Error('An independent disposable PostgreSQL database is required');

describe('process ledger soft deletion with actual protected HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const organizationId = randomUUID(), actorId = randomUUID(), roleId = randomUUID(), csrf = randomUUID();
  let cookie: string;
  const deletionPermission = 'process-quality:defects:delete';

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.organization.create({ data: { id: organizationId, code: `DELETE-${organizationId}`, name: 'Deletion isolated scope', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: actorId, organizationId, username: `DELETE-${actorId}`, passwordHash: 'test-only', accountType: 'INTERNAL' } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: `DELETE-${roleId}`, name: 'Delete granted explicitly' } });
    for (const code of ['process-quality:defects:read', 'process-quality:defects:write', deletionPermission]) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: actorId, organizationId, roleId } });
    const token = await app.get(SessionService).create(actorId, prisma, { reauthenticated: true });
    cookie = `qms_session=${token}; qms_csrf=${csrf}`;
  });

  afterAll(async () => { await app?.close(); });

  function post(path: string, body: object, key = randomUUID()) {
    return request(app.getHttpServer()).post(`/api/v1/process-quality/defects/${path}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }
  function create(extra: object = {}) {
    return prisma.processDefect.create({ data: { organizationId, description: 'Deletion source fact', createdById: actorId, updatedById: actorId, ...extra } });
  }
  const selection = (record: { id: string; version: number }) => ({ defectId: record.id, expectedVersion: record.version });

  it('previews and atomically deletes, preserves original identity and replays only while permission remains', async () => {
    const first = await create({ externalSourceSystem: 'IMS', externalRecordKey: randomUUID(), sourceKind: 'IMS', sourceReceiptId: randomUUID(), sourceRowIndex: 0 });
    const second = await create();
    const sources = [selection(first), selection(second)];
    const preview = await post('deletion-preview', { sources }).expect(201);
    expect(preview.body).toMatchObject({ count: 2, canDelete: true, items: expect.arrayContaining([expect.objectContaining({ defectId: first.id, blocked: false })]) });
    const command = { sources, reason: '重复登记，经确认删除' }, key = randomUUID();
    const deleted = await post('deletion', command, key).expect(201);
    expect(deleted.body).toEqual({ deletedIds: sources.map(item => item.defectId).sort(), count: 2 });
    expect((await post('deletion', command, key).expect(201)).body).toEqual(deleted.body);
    const stored = await prisma.processDefect.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored).toMatchObject({ version: 2, archivedAt: expect.any(Date), externalRecordKey: first.externalRecordKey, sourceReceiptId: first.sourceReceiptId });
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: first.id, action: 'PROCESS_DEFECTS_DELETED' } });
    expect(event.metadata).toMatchObject({ deletionReason: command.reason, rowCount: 2, previousResourceVersion: 1, resourceVersion: 2 });
    const list = await request(app.getHttpServer()).get('/api/v1/process-quality/defects?includeArchived=true').set('Cookie', cookie).expect(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).not.toContain(first.id);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: deletionPermission } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: permission.id } } });
    await post('deletion', command, key).expect(403);
    await post('deletion-preview', { sources: [selection(await create())] }).expect(403);
    await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
  });

  it('refuses the entire batch when a version changed after preview', async () => {
    const first = await create(), second = await create();
    const sources = [selection(first), selection(second)];
    await post('deletion-preview', { sources }).expect(201);
    await prisma.processDefect.update({ where: { id: second.id }, data: { version: { increment: 1 } } });
    await post('deletion', { sources, reason: '删除已失效预览' }).expect(409);
    expect(await prisma.processDefect.count({ where: { id: { in: [first.id, second.id] }, archivedAt: null } })).toBe(2);
  });

  it('blocks a newly linked formal issue and the legacy archive route', async () => {
    const record = await create(), sources = [selection(record)];
    await post('deletion-preview', { sources }).expect(201);
    const issue = await prisma.problemIndex.create({ data: { organizationId, domainCode: 'process-quality', problemType: 'PROCESS_DEFECT', sourceType: 'process-defect', sourceId: record.id, reportNumber: `D-${randomUUID()}`, severity: 'MEDIUM', createdById: actorId } });
    const preview = await post('deletion-preview', { sources }).expect(201);
    expect(preview.body).toMatchObject({ canDelete: false, items: [expect.objectContaining({ blocked: true, blockers: [expect.objectContaining({ reportNumber: null })] })] });
    expect(JSON.stringify(preview.body)).not.toContain(issue.reportNumber);
    const readPermission = await prisma.permission.upsert({ where: { code: 'process-quality:issues:read' }, create: { code: 'process-quality:issues:read', name: 'Read formal process issues' }, update: {} });
    await prisma.rolePermission.create({ data: { roleId, permissionId: readPermission.id } });
    try {
      const readable = await post('deletion-preview', { sources }).expect(201);
      expect(readable.body.items[0].blockers[0].reportNumber).toBe(issue.reportNumber);
    } finally { await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: readPermission.id } } }); }
    await post('deletion', { sources, reason: '不能删除正式引用' }).expect(409);
    await request(app.getHttpServer()).put(`/api/v1/process-quality/defects/${record.id}/archive`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1, reason: '旧接口也必须保护引用' }).expect(409);
    expect((await prisma.processDefect.findUniqueOrThrow({ where: { id: record.id } })).archivedAt).toBeNull();
  });

  it('rejects blank reasons, duplicate selections and the 101st selected record', async () => {
    const record = await create(), source = selection(record);
    await post('deletion', { sources: [source], reason: '   ' }).expect(400);
    await post('deletion-preview', { sources: [source, source] }).expect(400);
    await post('deletion-preview', { sources: [source, { ...source, defectId: source.defectId.toUpperCase() }] }).expect(400);
    await post('deletion-preview', { sources: Array.from({ length: 101 }, () => ({ defectId: randomUUID(), expectedVersion: 1 })) }).expect(400);
  });

  it.each([123, {}, []].flatMap(defectId => ['deletion-preview', 'deletion'].map(path => [path, defectId] as const)))('rejects malformed defect ID at %s: %j', async (path, defectId) => {
    const sources = [{ defectId, expectedVersion: 1 }];
    await post(path, { sources, ...(path === 'deletion' ? { reason: '无效编号必须拒绝' } : {}) }).expect(400);
  });

  it('keeps deleted IMS source IDs and receipt rows discoverable without resurrection or AI/completion writes', async () => {
    const record = await create({ externalSourceSystem: 'IMS', externalRecordKey: randomUUID(), sourceKind: 'IMS', sourceReceiptId: randomUUID(), sourceRowIndex: 3,
      registrationVersion: 1, pendingConfiguration: true, descriptionAiStatus: 'PENDING', descriptionInputVersion: 4 });
    await post('deletion', { sources: [selection(record)], reason: '撤销来源记录' }).expect(201);
    const adapter = app.get(ProcessDefectIngestionAdapter), session = await prisma.session.findFirstOrThrow({ where: { userId: actorId } });
    const actor = { id: actorId, organizationId, accountType: 'INTERNAL' as const, sessionId: session.id };
    const fields = { receiptId: randomUUID(), rowIndex: 0, externalRecordKey: record.externalRecordKey! };
    const byId = await prisma.$transaction(tx => adapter.inspect(tx, actor, fields));
    const byRow = await prisma.$transaction(tx => adapter.inspect(tx, actor, { receiptId: record.sourceReceiptId!, rowIndex: record.sourceRowIndex! }));
    expect(byId).toMatchObject({ id: record.id, deleted: true });
    expect(byRow).toMatchObject({ id: record.id, deleted: true });
    const before = await prisma.processDefect.findUniqueOrThrow({ where: { id: record.id } });
    await prisma.$transaction(async tx => {
      await adapter.markAiDescription(tx, actor, record.id, 4, 'FAILED');
      expect(await adapter.applyAiDescription(tx, actor, record.id, 4, record.description, '新的 AI 描述', randomUUID())).toBe('STALE');
    });
    await app.get(ProcessDefectCompletionService).processDue();
    expect(await prisma.processDefect.findUniqueOrThrow({ where: { id: record.id } })).toEqual(before);
    expect(await prisma.processDefect.count({ where: { organizationId, externalRecordKey: record.externalRecordKey } })).toBe(1);
  });

  it('blocks new product selections without leaking another domain project code', async () => {
    const record = await create(), projectId = randomUUID();
    await prisma.$executeRaw`INSERT INTO new_product_projects(id,organization_id,code,name,product_code,created_by_id)
      VALUES(${projectId}::uuid,${organizationId}::uuid,'PRIVATE-PROJECT','New product','P1',${actorId}::uuid)`;
    await prisma.$executeRaw`INSERT INTO new_product_defect_selections(id,organization_id,project_id,defect_id,source_version,source_snapshot,selected_by_id)
      VALUES(${randomUUID()}::uuid,${organizationId}::uuid,${projectId}::uuid,${record.id}::uuid,1,'{}'::jsonb,${actorId}::uuid)`;
    const preview = await post('deletion-preview', { sources: [selection(record)] }).expect(201);
    expect(preview.body).toMatchObject({ canDelete: false, items: [expect.objectContaining({ blockers: [{ code: 'NEW_PRODUCT_SELECTION', reportNumber: null }] })] });
    expect(JSON.stringify(preview.body)).not.toContain('PRIVATE-PROJECT');
    await post('deletion', { sources: [selection(record)], reason: '新品来源受保护' }).expect(409);
  });

  it('deletes the supported selection limit of 100 records atomically', async () => {
    const ids = Array.from({ length: 100 }, () => randomUUID());
    await prisma.processDefect.createMany({ data: ids.map(id => ({ id, organizationId, description: 'Batch deletion limit', createdById: actorId, updatedById: actorId })) });
    const sources = ids.map(defectId => ({ defectId, expectedVersion: 1 }));
    expect((await post('deletion-preview', { sources }).expect(201)).body).toMatchObject({ count: 100, canDelete: true });
    expect((await post('deletion', { sources, reason: '删除所选100条' }).expect(201)).body).toMatchObject({ count: 100 });
    expect(await prisma.processDefect.count({ where: { id: { in: ids }, archivedAt: { not: null }, version: 2 } })).toBe(100);
  });

  it('waits on the shared source lock and detects a formal issue committed while deletion is waiting', async () => {
    const record = await create(), ledger = app.get(ProcessDefectLedgerService);
    const session = await prisma.session.findFirstOrThrow({ where: { userId: actorId } });
    const actor = { id: actorId, organizationId, accountType: 'INTERNAL' as const, sessionId: session.id };
    let deletion: Promise<unknown>;
    await prisma.$transaction(async tx => {
      await ledger.lockAndResolve(tx, { sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: record.id, sourceVersion: 1, sourceSnapshot: {}, createdBy: actorId });
      const [connection] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      deletion = ledger.deleteDefects(actor, { sources: [selection(record)], reason: '并发正式引用' }, randomUUID(), randomUUID()).catch(error => error);
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
        const [waiting] = await tx.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${connection!.pid} = ANY(pg_blocking_pids(pid))) AS blocked`;
        blocked = waiting!.blocked;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 5));
      }
      expect(blocked).toBe(true);
      await tx.problemIndex.create({ data: { organizationId, domainCode: 'process-quality', problemType: 'PROCESS_DEFECT', sourceType: 'process-defect', sourceId: record.id,
        reportNumber: `RACE-${randomUUID()}`, severity: 'HIGH', createdById: actorId } });
    }, { isolationLevel: 'ReadCommitted' });
    expect(await deletion!).toMatchObject({ status: 409, response: { code: 'PROCESS_DEFECT_DELETE_BLOCKED' } });
    expect((await prisma.processDefect.findUniqueOrThrow({ where: { id: record.id } })).archivedAt).toBeNull();
  });
});
