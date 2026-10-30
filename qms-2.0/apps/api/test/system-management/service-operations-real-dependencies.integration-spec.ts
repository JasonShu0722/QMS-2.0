import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { FILE_RESOURCE_ADAPTERS } from '../../src/modules/file-management/file-resource-access.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import { FileOperationsReadService } from '../../src/modules/file-management/file-operations-read.service.js';
import { MailOperationsReadService } from '../../src/modules/identity/mail-operations-read.service.js';
import { RecoveryMailService } from '../../src/modules/identity/recovery-mail.service.js';
import { NeutralFileResourceAdapter, neutralFileFixture } from '../file-management/file-fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Disposable service dependencies required.');

describe('real object scan and SMTP operation facts, not configuration-only health', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let context: Awaited<ReturnType<typeof neutralFileFixture>>;
  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(FILE_RESOURCE_ADAPTERS).useValue([new NeutralFileResourceAdapter()]).compile();
    await module.init(); prisma = module.get(PrismaService);
    context = await neutralFileFixture(prisma);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'console:services:read' } });
    const role = await prisma.role.create({ data: { organizationId: context.organization.id, code: randomUUID(), name: 'Services fixture' } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    await prisma.userRole.create({ data: { roleId: role.id, userId: context.user.id, organizationId: context.organization.id } });
  });
  afterAll(async () => {
    try {
      if (context) {
        const org = context.organization.id;
        const fileIds = (await prisma.fileObject.findMany({ where: { organizationId: org }, select: { id: true } })).map(file => file.id);
        await prisma.outboxEvent.deleteMany({ where: { aggregateType: 'FileObject', aggregateId: { in: fileIds } } });
        await prisma.auditEvent.deleteMany({ where: { organizationId: org } });
        await prisma.fileUploadReceipt.deleteMany({ where: { fileId: { in: fileIds } } });
        await prisma.fileObject.deleteMany({ where: { organizationId: org } });
        await prisma.problemIndex.delete({ where: { id: context.problem.id } });
        await prisma.userRole.deleteMany({ where: { organizationId: org } });
        await prisma.role.deleteMany({ where: { organizationId: org } });
        await prisma.user.delete({ where: { id: context.user.id } });
        await prisma.organization.delete({ where: { id: org } });
      }
    } finally { await module?.close(); }
  });
  it('shows a real storage upload and ClamAV scan result without exposing the object key or scanner host', async () => {
    const files = module.get(FileLifecycleService);
    const bytes = Buffer.from('Safe service observation attachment fixture.');
    const upload = await files.initializeUpload(context.actor, { ...context.resource, originalName: 'fixture.txt', contentType: 'text/plain', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, randomUUID(), randomUUID());
    expect((await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: bytes })).status).toBe(200);
    await files.complete(context.actor, upload.file.id, 1, randomUUID(), randomUUID());
    await module.get(FileScanWorkerService).processDue(100);
    expect(await files.get(context.actor, upload.file.id)).toMatchObject({ scanStatus: 'CLEAN', status: 'AVAILABLE' });
    const facts = await module.get(FileOperationsReadService).read(context.actor, context.organization.id);
    expect(facts).toMatchObject({ configured: true, counts: { succeeded: 1 }, latest: { status: 'SUCCEEDED', observedAt: expect.any(String) } });
    expect(JSON.stringify(facts)).not.toMatch(/objectKey|scannerEngine|localhost|127\.0\.0\.1|fixture\.txt/);
  });
  it('shows actual Mailpit delivery time and safe counts without exposing recipient or recovery credentials', async () => {
    const email = `services-${randomUUID()}@example.test`;
    const user = await prisma.user.update({ where: { id: context.user.id }, data: { email } });
    const mail = module.get(RecoveryMailService);
    await prisma.$transaction(tx => mail.enqueue(tx, user, 'VERIFY_EMAIL'));
    await mail.dispatchPending();
    const sent = await prisma.recoveryDelivery.findFirstOrThrow({ where: { verification: { userId: user.id } }, select: { sentAt: true, status: true } });
    expect(sent).toMatchObject({ status: 'SENT', sentAt: expect.any(Date) });
    const response = await fetch(`${process.env.QMS_ACCEPTANCE_MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    expect(response.status).toBe(200);
    expect((await response.json() as { total: number }).total).toBeGreaterThan(0);
    const facts = await module.get(MailOperationsReadService).read(context.actor, context.organization.id);
    expect(facts).toMatchObject({ configured: true, counts: { succeeded: 1 }, latest: { status: 'SUCCEEDED', observedAt: sent.sentAt!.toISOString() } });
    expect(JSON.stringify(facts)).not.toMatch(/recipient|encryptedPayload|token|127\.0\.0\.1|@example/);
  });
});
