import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { SupplierSourceCollaborationReadModel } from '../../src/modules/problem-index/supplier-source-collaboration.read-model.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Disposable loopback PostgreSQL required; never preview 55440.');
}

describe('supplier source collaboration platform public read model', () => {
  const db = new PrismaService();
  const model = new SupplierSourceCollaborationReadModel();
  beforeAll(async () => { await db.$connect(); await db.$queryRaw`SELECT 1`; });
  afterAll(async () => { await db.$disconnect(); });

  async function fixture() {
    const organization = await db.organization.create({ data: { code: randomUUID(), name: 'Collaboration platform facts', type: 'INTERNAL' } });
    return { organizationId: organization.id };
  }

  async function problem(organizationId: string, overrides: Record<string, unknown> = {}) {
    return db.problemIndex.create({ data: { organizationId, reportNumber: randomUUID(), domainCode: 'process-quality',
      problemType: 'PROCESS_DEFECT', sourceType: 'process-defect', sourceId: randomUUID(), severity: 'LOW', ...overrides } });
  }

  it('reads bounded active organization candidates with a real cursor and no report metadata', async () => {
    const f = await fixture();
    const active = await Promise.all([problem(f.organizationId), problem(f.organizationId), problem(f.organizationId)]);
    await problem(f.organizationId, { status: 'CLOSED' });
    await problem(f.organizationId, { status: 'ARCHIVED' });
    await problem(f.organizationId, { archivedAt: new Date() });
    await problem(f.organizationId, { closedAt: new Date() });
    await problem(f.organizationId, { domainCode: 'supplier-quality' });
    await problem((await fixture()).organizationId);
    const before = await db.problemIndex.findMany({ where: { organizationId: f.organizationId }, orderBy: { id: 'asc' } });
    const read = (after?: string) => db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return model.scanTrusted(tx, f.organizationId, { after, scanLimit: 2 });
    });
    const first = await read();
    expect(first).toEqual({ candidates: active.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 2).map(p => ({ problemId: p.id, domainCode: p.domainCode })),
      scannedCount: 2, nextCursor: active[1].id });
    const second = await read(first.nextCursor ?? undefined);
    expect(second).toEqual({ candidates: [{ problemId: active[2].id, domainCode: active[2].domainCode }], scannedCount: 1, nextCursor: null });
    expect(await db.problemIndex.findMany({ where: { organizationId: f.organizationId }, orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('rechecks current active links without a fallback to primary or a saved snapshot', async () => {
    const f = await fixture(); const p = await problem(f.organizationId);
    const sourceId = randomUUID(); const removedId = randomUUID();
    for (const id of [sourceId, removedId]) await db.domainSourceIssueLink.create({ data: { organizationId: f.organizationId,
      problemIndexId: p.id, sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: id,
      sourceVersion: 1, sourceSnapshot: { privateText: 'Never expose this or a VIN' }, createdBy: randomUUID(),
      ...(id === removedId ? { removedAt: new Date() } : {}) } });
    const read = (organizationId = f.organizationId) => db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return model.currentReferences(tx, organizationId, p.id);
    });
    const before = await db.domainSourceIssueLink.findMany({ where: { problemIndexId: p.id } });
    expect(await read()).toEqual([{ sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId }]);
    expect(await read((await fixture()).organizationId)).toEqual([]);
    expect(await db.domainSourceIssueLink.findMany({ where: { problemIndexId: p.id } })).toEqual(before);
    await db.problemIndex.update({ where: { id: p.id }, data: { status: 'CLOSED' } });
    expect(await read()).toEqual([]);
    await db.problemIndex.update({ where: { id: p.id }, data: { status: 'IN_PROGRESS' } });
    await db.domainSourceIssueLink.updateMany({ where: { problemIndexId: p.id }, data: { removedAt: new Date() } });
    expect(await read()).toEqual([]);
  });

  it('rejects invalid cursor and unbounded scans before issuing a query', async () => {
    const f = await fixture();
    for (const query of [{ after: 'not-a-uuid' }, { scanLimit: 0 }, { scanLimit: 101 }, { scanLimit: 1.5 }]) {
      await expect(db.$transaction(tx => model.scanTrusted(tx, f.organizationId, query))).rejects.toMatchObject({ status: 400 });
    }
  });

  it('applies a server-owned current-link predicate before counting and cursor slicing in a read-only transaction', async () => {
    const f = await fixture();
    const allowedId = randomUUID(); let allowedProblemId = '';
    for (let i = 0; i < 3; i++) {
      const p = await problem(f.organizationId);
      if (i === 1) allowedProblemId = p.id;
      await db.domainSourceIssueLink.create({ data: { organizationId: f.organizationId, problemIndexId: p.id, sourceDomain: 'process-quality',
        sourceType: 'process-defect', sourceId: i === 1 ? allowedId : randomUUID(), sourceVersion: 1, sourceSnapshot: {}, createdBy: randomUUID() } });
    }
    const read = (predicate: Prisma.Sql) => db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return model.scan(tx, f.organizationId, predicate, { scanLimit: 1 });
    });
    expect(await read(Prisma.sql`FALSE`)).toEqual({ candidates: [], scannedCount: 0, nextCursor: null });
    expect(await read(Prisma.sql`collaboration_link.source_id = ${allowedId}::uuid`)).toEqual({
      candidates: [{ problemId: allowedProblemId, domainCode: 'process-quality' }], scannedCount: 1, nextCursor: null });
  });
});
