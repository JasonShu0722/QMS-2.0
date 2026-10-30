import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../../src/database/database.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ServiceOperationReceiptService } from '../../src/modules/task-notification/service-operation-receipt.service.js';
import { ProcessEightDReportService } from '../../src/modules/process-quality/process-eight-d-report.service.js';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Disposable PDF receipt PostgreSQL required.');

describe('actual PDF thread execution with persisted operation receipts', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  const organizationId = randomUUID();
  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [DatabaseModule] }).compile(); await module.init(); prisma = module.get(PrismaService);
  });
  afterAll(async () => {
    try { await prisma.serviceOperationReceipt.deleteMany({ where: { scopeKey: organizationId } }); }
    finally { await module.close(); }
  });
  it('records the real per-request PDF render without creating a permanent queue or storing report data', async () => {
    const actor = { id: randomUUID(), organizationId, accountType: 'INTERNAL' as const, sessionId: randomUUID() };
    const id = randomUUID();
    const snapshot = { document: emptyProcessEightDDocument(), sources: [], problem: { id, organizationId, domainCode: 'process-quality', reportNumber: 'SAFE-PDF-FIXTURE', closedAt: null }, instance: { version: 1 },
      contentVersion: 1, rowVersion: 1, ownerUserId: actor.id, professionalUserId: actor.id, responsibleSectionDepartmentId: randomUUID(), collaboratorUserIds: [],
      deadlines: { analysisDueAt: null, submissionDueAt: null, closureDueAt: null }, analysisCompletedAt: null, submittedAt: null };
    const selected = { record: { report: { closedRevisionId: null }, problem: { id, organizationId, domainCode: 'process-quality' }, node: { config: {} } }, revision: null, snapshot };
    // Domain authorization is exercised in its own complete files; this test isolates the actual thread and receipt store.
    const tx = { user: { findUnique: async () => ({ ...actor, status: 'ACTIVE', organization: { status: 'ACTIVE' } }) }, organization: { findUnique: async () => ({ status: 'ACTIVE' }) }, $queryRaw: async () => [{ allowed: true }] };
    const boundary = { $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) };
    const core = { readReport: async () => structuredClone(selected) };
    const service = Reflect.construct(ProcessEightDReportService, [boundary, core, {}, {}, { record: async () => undefined }, undefined, new ServiceOperationReceiptService(prisma)]) as ProcessEightDReportService;
    const result = await service.pdf(actor, id, {}, randomUUID());
    expect(result.content.subarray(0, 4).toString()).toBe('%PDF');
    const rows = await prisma.serviceOperationReceipt.findMany({ where: { scopeKey: organizationId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ operation: 'PDF', domainCode: 'process-quality', status: 'SUCCEEDED', durationMs: expect.any(Number), completedAt: expect.any(Date) });
    expect(JSON.stringify(rows)).not.toContain('SAFE-PDF-FIXTURE');
  });
});
