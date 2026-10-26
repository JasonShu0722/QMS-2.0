import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { FileManagementModule } from '../../src/modules/file-management/file-management.module.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FILE_RESOURCE_ADAPTERS } from '../../src/modules/file-management/file-resource-access.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import { FileVerificationService } from '../../src/modules/file-management/file-verification.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../../src/modules/file-management/object-storage.service.js';
import { NeutralFileResourceAdapter, neutralFileFixture } from './file-fixture.js';

const database = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (!database || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(database.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) || database.port === '55440' || database.search || database.hash) {
  throw new Error('Report evidence requires disposable loopback PostgreSQL, never preview 55440.');
}
for (const name of ['QMS_OBJECT_STORAGE_ENDPOINT', 'QMS_OBJECT_STORAGE_BUCKET', 'QMS_FILE_SCANNER_HOST', 'QMS_FILE_SCANNER_PORT']) {
  if (!process.env[name]) throw new Error(`Real report evidence integration requires ${name}`);
}

describe('report attachment references on real PostgreSQL, versioned storage and scanner', () => {
  let module: TestingModule, prisma: PrismaService, files: FileLifecycleService, storage: ObjectStorage, scanner: FileScanWorkerService;
  let context: Awaited<ReturnType<typeof neutralFileFixture>>;
  const organizations: string[] = [];
  const bytes = Buffer.from('Real versioned report evidence, not declared CLEAN metadata.');
  const hash = createHash('sha256').update(bytes).digest('hex');
  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [FileManagementModule] })
      .overrideProvider(FILE_RESOURCE_ADAPTERS).useValue([new NeutralFileResourceAdapter()]).compile();
    await module.init();
    prisma = module.get(PrismaService); files = module.get(FileLifecycleService); storage = module.get(OBJECT_STORAGE);
    const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS "now"`;
    const offset = now.getTime() - Date.now() + 1000;
    scanner = new FileScanWorkerService(prisma, module.get(FileVerificationService), module.get(AuditLogService), () => new Date(Date.now() + offset));
  }, 120_000);
  beforeEach(async () => { context = await neutralFileFixture(prisma); organizations.push(context.organization.id); });
  afterAll(async () => {
    try {
      if (prisma) {
        const objects = await prisma.fileObject.findMany({ where: { organizationId: { in: organizations } }, select: { id: true } });
        await prisma.outboxEvent.deleteMany({ where: { aggregateType: 'FileObject', aggregateId: { in: objects.map(file => file.id) } } });
      }
    } finally { await module?.close(); }
  });
  const groups = (id: string) => [{ resource: context.resource, fileIds: [id] }];
  async function cleanFile() {
    const upload = await files.initializeUpload(context.actor, { ...context.resource, originalName: 'report.txt', contentType: 'text/plain',
      sizeBytes: bytes.length, sha256: hash }, randomUUID(), randomUUID());
    expect((await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: bytes })).status).toBe(200);
    await files.complete(context.actor, upload.file.id, upload.file.version, randomUUID(), randomUUID());
    await scanner.processDue(100);
    expect(await files.get(context.actor, upload.file.id)).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN' });
    return upload.file.id;
  }

  it('pins verified object versions after the resource lock and audits every downloaded attachment', async () => {
    const id = await cleanFile(), traceId = randomUUID();
    const refs = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM problem_indexes WHERE id = ${context.problem.id}::uuid FOR UPDATE`;
      return files.readReportEvidence(tx, context.actor, groups(id), traceId);
    }, { isolationLevel: 'ReadCommitted' });
    expect(refs).toHaveLength(1);
    const ref = refs[0]!;
    expect(ref).toMatchObject({ id, sha256: hash, sizeBytes: bytes.length, downloadable: true });
    const chunks: Buffer[] = [];
    for await (const chunk of storage.readVersion(ref.objectKey, ref.objectVersionId, bytes.length)) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(createHash('sha256').update(Buffer.concat(chunks)).digest('hex')).toBe(ref.sha256);
    const events = await prisma.auditEvent.findMany({ where: { resourceId: id, traceId, action: 'ATTACHMENT_DOWNLOAD_AUTHORIZED' } });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(ref.objectKey);
  }, 120_000);

  it('does not request a late user write lock after the domain lock, even when another transaction holds FOR SHARE', async () => {
    const id = await cleanFile();
    let release!: () => void, signal!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { signal = resolve; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${context.actor.id}::uuid FOR SHARE`;
      signal(); await released;
    }, { timeout: 15_000 });
    try {
      await Promise.race([locked, holder.then(() => { throw new Error('User share lock not acquired'); })]);
      const refs = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
        await tx.$queryRaw`SELECT id FROM problem_indexes WHERE id = ${context.problem.id}::uuid FOR UPDATE`;
        return files.readReportEvidence(tx, context.actor, groups(id), randomUUID());
      }, { isolationLevel: 'ReadCommitted', timeout: 10_000 });
      expect(refs[0]).toMatchObject({ id, downloadable: true });
    } finally { release(); await holder; }
  }, 120_000);

  it('denies another real resource and a revoked real session without recording download success', async () => {
    const id = await cleanFile(), traceId = randomUUID();
    const other = await neutralFileFixture(prisma); organizations.push(other.organization.id);
    await expect(prisma.$transaction(tx => files.readReportEvidence(tx, other.actor,
      [{ resource: other.resource, fileIds: [id] }], traceId), { isolationLevel: 'ReadCommitted' }))
      .rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
    await prisma.session.update({ where: { id: context.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(prisma.$transaction(tx => files.readReportEvidence(tx, context.actor, groups(id), traceId), { isolationLevel: 'ReadCommitted' }))
      .rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
    expect(await prisma.auditEvent.count({ where: { traceId, action: 'ATTACHMENT_DOWNLOAD_AUTHORIZED' } })).toBe(0);
  }, 120_000);
});
