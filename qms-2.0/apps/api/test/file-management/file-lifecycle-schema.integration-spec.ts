import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Test, type TestingModule } from '@nestjs/testing';
import { FileManagementModule } from '../../src/modules/file-management/file-management.module.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { FILE_RESOURCE_ADAPTERS, FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../../src/modules/file-management/object-storage.service.js';
import { FilePolicyService } from '../../src/modules/file-management/file-policy.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import { FileVerificationService } from '../../src/modules/file-management/file-verification.service.js';
import { FileScannerService } from '../../src/modules/file-management/file-scanner.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { NeutralFileResourceAdapter, neutralFileFixture } from './file-fixture.js';
import { timingFixture, clearTimingEvents } from '../task-notification/workflow-timing-fixture.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { OutboxAdministrationService } from '../../src/modules/task-notification/outbox-administration.service.js';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';

for (const name of ['DATABASE_URL', 'QMS_OBJECT_STORAGE_ENDPOINT', 'QMS_OBJECT_STORAGE_BUCKET', 'QMS_FILE_SCANNER_HOST', 'QMS_FILE_SCANNER_PORT', 'QMS_FILE_TEST_ENCRYPTED_PATH']) {
  if (!process.env[name]) throw new Error(`Real attachment integration requires ${name}`);
}

describe('attachment lifecycle on real PostgreSQL and object storage', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let files: FileLifecycleService;
  let storage: ObjectStorage;
  let scanWorker: FileScanWorkerService;
  let context: Awaited<ReturnType<typeof neutralFileFixture>>;
  const organizations: string[] = [];
  const bytes = Buffer.from('Quality evidence for the attachment lifecycle.');
  const input = () => ({ ...context.resource, originalName: 'evidence.txt', contentType: 'text/plain', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [FileManagementModule] }).overrideProvider(FILE_RESOURCE_ADAPTERS).useValue([new NeutralFileResourceAdapter()]).compile();
    await module.init();
    prisma = module.get(PrismaService);
    files = module.get(FileLifecycleService);
    storage = module.get(OBJECT_STORAGE);
    const [{ now: databaseNow }] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS "now"`;
    const clockOffset = databaseNow.getTime() - Date.now() + 1000;
    scanWorker = new FileScanWorkerService(prisma, module.get(FileVerificationService), module.get(AuditLogService), () => new Date(Date.now() + clockOffset));
  });
  async function fixture(accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const created = await neutralFileFixture(prisma, accountType);
    organizations.push(created.organization.id);
    return created;
  }
  beforeEach(async () => { context = await fixture(); });
  afterEach(async () => {
    const records = await prisma.fileObject.findMany({ where: { organizationId: { in: organizations } }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateType: 'FileObject', aggregateId: { in: records.map((file) => file.id) } } });
    await clearTimingEvents(prisma, organizations);
  });
  afterAll(() => module?.close());

  it('denies an unregistered resource with the production empty registry', async () => {
    const production = new FileLifecycleService(prisma, module.get(FilePolicyService), storage, module.get(AuditLogService), new FileResourceAccess([]));
    await expect(production.initializeUpload(context.actor, input(), randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
  });

  it('cannot make a file available with only declared metadata', async () => {
    await expect(prisma.fileObject.create({ data: { organizationId: context.actor.organizationId, objectKey: randomUUID(), originalName: 'unverified.txt', contentType: 'text/plain', sizeBytes: 12, sha256: 'a'.repeat(64), status: 'AVAILABLE', uploadedById: context.actor.id } })).rejects.toThrow();
  });

  it('keeps every account isolated until real versioned upload, hash, type and ClamAV pass', async () => {
    for (const accountType of ['INTERNAL', 'SUPPLIER'] as const) {
      context = await fixture(accountType);
      const upload = await files.initializeUpload(context.actor, input(), randomUUID(), randomUUID());
      expect(upload.file).toMatchObject({ status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD' });
      await expect(files.download(context.actor, upload.file.id, randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_NOT_AVAILABLE' } });
      await expect(files.complete(context.actor, upload.file.id, 1, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_OBJECT_UNAVAILABLE' } });
      expect((await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: bytes })).status).toBe(200);
      const key = randomUUID();
      expect(await files.complete(context.actor, upload.file.id, 1, key, randomUUID())).toMatchObject({ status: 'QUARANTINED', scanStatus: 'PENDING', version: 2 });
      expect(await files.complete(context.actor, upload.file.id, 1, key, randomUUID())).toMatchObject({ version: 2 });
      await scanWorker.processDue(100);
      expect(await files.get(context.actor, upload.file.id)).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN', version: 3 });
      const download = await files.download(context.actor, upload.file.id, randomUUID());
      const response = await fetch(download.url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toContain('attachment');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    }
  });

  async function uploaded(content = bytes, contentType = 'text/plain', declaration: Partial<ReturnType<typeof input>> = {}) {
    const upload = await files.initializeUpload(context.actor, { ...input(), contentType, sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex'), ...declaration }, randomUUID(), randomUUID());
    expect((await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: content })).status).toBe(200);
    return upload;
  }

  async function completed(content = bytes, contentType = 'text/plain', declaration: Partial<ReturnType<typeof input>> = {}) {
    const upload = await uploaded(content, contentType, declaration);
    await files.complete(context.actor, upload.file.id, 1, randomUUID(), randomUUID());
    return prisma.fileObject.findUniqueOrThrow({ where: { id: upload.file.id } });
  }

  it('reads report evidence in one authorized batch without treating pending or deleted files as downloadable', async () => {
    const clean = await completed();
    const removed = await completed();
    await scanWorker.processDue(100);
    const deleted = await files.get(context.actor, removed.id);
    await files.deleteLogically(context.actor, removed.id, deleted.version, randomUUID());
    const pending = await files.initializeUpload(context.actor, input(), randomUUID(), randomUUID());
    const groups = [{ resource: context.resource, fileIds: [pending.file.id, removed.id, clean.id] }];
    const result = await prisma.$transaction((tx) => files.readEvidence(tx, context.actor, groups), { isolationLevel: 'ReadCommitted' });
    expect(result).toHaveLength(3);
    expect(result.find((file) => file.id === clean.id)).toMatchObject({ downloadable: true, status: 'AVAILABLE' });
    expect(result.find((file) => file.id === removed.id)).toMatchObject({ downloadable: false, status: 'DELETED' });
    expect(result.find((file) => file.id === pending.file.id)).toMatchObject({ downloadable: false, status: 'QUARANTINED' });
    expect(JSON.stringify(result)).not.toMatch(/objectKey|objectVersionId|uploadUrl|downloadUrl/);
    const foreign = await fixture();
    await expect(prisma.$transaction((tx) => files.readEvidence(tx, context.actor, [{ resource: foreign.resource, fileIds: [clean.id] }]), { isolationLevel: 'ReadCommitted' })).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
    await expect(prisma.$transaction((tx) => files.readEvidence(tx, context.actor, [{ resource: context.resource, fileIds: [clean.id, clean.id] }]), { isolationLevel: 'ReadCommitted' })).rejects.toMatchObject({ response: { code: 'FILE_UPLOAD_INVALID' } });
    await prisma.session.update({ where: { id: context.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(prisma.$transaction((tx) => files.readEvidence(tx, context.actor, groups), { isolationLevel: 'ReadCommitted' })).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
  });

  it('revalidates idempotent upload receipts and serializes resource quota reservations', async () => {
    const key = randomUUID();
    const upload = await files.initializeUpload(context.actor, input(), key, randomUUID());
    expect((await files.initializeUpload(context.actor, input(), key, randomUUID())).file.id).toBe(upload.file.id);
    await expect(files.initializeUpload(context.actor, { ...input(), originalName: 'different.txt' }, key, randomUUID())).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_REPLAY' } });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => files.initializeUpload(context.actor, input(), randomUUID(), randomUUID())));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(9);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([{ reason: { response: { code: 'FILE_QUOTA_EXCEEDED' } } }]);
    await prisma.session.update({ where: { id: context.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(files.initializeUpload(context.actor, input(), key, randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
  });

  it('counts pending bytes toward the total quota and releases expired reservations', async () => {
    const first = await files.initializeUpload(context.actor, { ...input(), sizeBytes: 20 * 1024 * 1024 }, randomUUID(), randomUUID());
    await expect(files.initializeUpload(context.actor, { ...input(), sizeBytes: 10 * 1024 * 1024 }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_QUOTA_EXCEEDED' } });
    await prisma.fileObject.update({ where: { id: first.file.id }, data: { uploadExpiresAt: new Date(0) } });
    expect(await scanWorker.expireUploads()).toBeGreaterThanOrEqual(1);
    await expect(files.complete(context.actor, first.file.id, 2, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_UPLOAD_EXPIRED' } });
    await expect(files.initializeUpload(context.actor, { ...input(), sizeBytes: 10 * 1024 * 1024 }, randomUUID(), randomUUID())).resolves.toBeDefined();
  });

  it('fixes exactly one object version and scan event under concurrent completion', async () => {
    const upload = await uploaded();
    const key = randomUUID();
    const results = await Promise.all([files.complete(context.actor, upload.file.id, 1, key, randomUUID()), files.complete(context.actor, upload.file.id, 1, key, randomUUID())]);
    expect(results[0]).toEqual(results[1]);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: upload.file.id, eventType: 'FILE_SCAN_REQUESTED' } })).toBe(1);
    await expect(files.complete(context.actor, upload.file.id, 1, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
  });

  it('rejects actual MIME, hash and HEAD length mismatches', async () => {
    const wrongType = await completed(bytes, 'application/pdf');
    const wrongHash = await completed(bytes, 'text/plain', { sha256: 'a'.repeat(64) });
    const wrongSize = await uploaded(bytes, 'text/plain', { sizeBytes: bytes.length + 1 });
    await expect(files.complete(context.actor, wrongSize.file.id, 1, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_CONTENT_MISMATCH' } });
    expect(await scanWorker.processDue(100)).toMatchObject({ processed: 2, retried: 0, failed: 0 });
    expect(await files.get(context.actor, wrongType.id)).toMatchObject({ status: 'QUARANTINED', scanStatus: 'REJECTED', scanReason: 'FILE_CONTENT_TYPE_MISMATCH' });
    expect(await files.get(context.actor, wrongHash.id)).toMatchObject({ status: 'QUARANTINED', scanStatus: 'REJECTED', scanReason: 'FILE_CONTENT_MISMATCH' });
    await expect(files.download(context.actor, wrongHash.id, randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_NOT_AVAILABLE' } });
  });

  it('rejects the harmless EICAR diagnostic signature both directly and inside ZIP, and encrypted archives', async () => {
    const diagnostic = Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
    const archive = Buffer.from(zipSync({ 'diagnostic.txt': diagnostic }));
    const encrypted = await readFile(process.env.QMS_FILE_TEST_ENCRYPTED_PATH!);
    for (const [content, contentType] of [[diagnostic, 'text/plain'], [archive, 'application/zip'], [encrypted, 'application/zip']] as const) {
      const file = await completed(content, contentType);
      await scanWorker.processDue(100);
      expect(await files.get(context.actor, file.id)).toMatchObject({ status: 'QUARANTINED', scanStatus: 'REJECTED' });
      expect((await prisma.fileObject.findUniqueOrThrow({ where: { id: file.id } })).scannerEngine).toMatch(/^ClamAV /);
    }
  });

  it('rejects unknown binary MIME and the real engine archive recursion limit', async () => {
    const unknown = await completed(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 255, 128, 0, 255]), 'text/plain');
    let archive = Buffer.from('clean recursion limit diagnostic');
    for (let depth = 0; depth < 12; depth += 1) archive = Buffer.from(zipSync({ [`level-${depth}.${depth ? 'zip' : 'txt'}`]: archive }));
    const limited = await completed(archive, 'application/zip');
    await scanWorker.processDue(100);
    expect(await files.get(context.actor, unknown.id)).toMatchObject({ status: 'QUARANTINED', scanStatus: 'REJECTED', scanReason: 'FILE_CONTENT_TYPE_MISMATCH' });
    expect(await files.get(context.actor, limited.id)).toMatchObject({ status: 'QUARANTINED', scanStatus: 'REJECTED', scanReason: 'FILE_SCAN_POLICY_REJECTED' });
  });

  it('reads and scans the frozen object version even if an administrator creates a newer latest version', async () => {
    const file = await completed();
    const client = new S3Client({ endpoint: process.env.QMS_OBJECT_STORAGE_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
      credentials: { accessKeyId: process.env.QMS_OBJECT_STORAGE_ACCESS_KEY!, secretAccessKey: process.env.QMS_OBJECT_STORAGE_SECRET_KEY! } });
    try {
      const replaced = await client.send(new PutObjectCommand({ Bucket: process.env.QMS_OBJECT_STORAGE_BUCKET!, Key: file.objectKey, ContentType: 'text/plain', Body: Buffer.from('new latest is not the submitted evidence') }));
      expect(replaced.VersionId).not.toBe(file.objectVersionId);
      await scanWorker.processDue(100);
      const signed = await files.download(context.actor, file.id, randomUUID());
      expect(new URL(signed.url).searchParams.get('versionId')).toBe(file.objectVersionId);
      expect(Buffer.from(await (await fetch(signed.url)).arrayBuffer())).toEqual(bytes);
    } finally { client.destroy(); }
  });

  it('requires exact resource ownership for reads, deletes, and atomic domain attachment', async () => {
    const file = await completed();
    await scanWorker.processDue(100);
    const foreign = await fixture('SUPPLIER');
    await expect(files.get(foreign.actor, file.id)).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
    await expect(files.deleteLogically(foreign.actor, file.id, 3, randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
    await expect(prisma.$transaction((tx) => files.assertAttachable(tx, context.actor, context.resource, [file.id]), { isolationLevel: 'ReadCommitted' })).resolves.toHaveLength(1);
    await expect(prisma.$transaction((tx) => files.assertAttachable(tx, foreign.actor, foreign.resource, [file.id]), { isolationLevel: 'ReadCommitted' })).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
    await files.deleteLogically(context.actor, file.id, 3, randomUUID());
    await expect(files.download(context.actor, file.id, randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_NOT_AVAILABLE' } });
    await expect(prisma.$transaction((tx) => files.assertAttachable(tx, context.actor, context.resource, [file.id]), { isolationLevel: 'ReadCommitted' })).rejects.toMatchObject({ response: { code: 'FILE_NOT_AVAILABLE' } });
    expect(await prisma.fileObject.findUnique({ where: { id: file.id } })).toMatchObject({ objectVersionId: file.objectVersionId, deletedById: context.actor.id, status: 'DELETED' });
  });

  it('rolls back metadata, completion, and deletion when their audits fail', async () => {
    const failure = new FileLifecycleService(prisma, module.get(FilePolicyService), storage, { record: async () => { throw new Error('audit unavailable'); } } as unknown as AuditLogService, module.get(FileResourceAccess));
    await expect(failure.initializeUpload(context.actor, input(), randomUUID(), randomUUID())).rejects.toThrow('audit unavailable');
    expect(await prisma.fileObject.count({ where: { organizationId: context.organization.id } })).toBe(0);
    const upload = await uploaded();
    await expect(failure.complete(context.actor, upload.file.id, 1, randomUUID(), randomUUID())).rejects.toThrow('audit unavailable');
    expect(await prisma.fileObject.findUnique({ where: { id: upload.file.id } })).toMatchObject({ objectVersionId: null, version: 1 });
    expect(await prisma.outboxEvent.count({ where: { aggregateId: upload.file.id } })).toBe(0);
    await expect(failure.deleteLogically(context.actor, upload.file.id, 1, randomUUID())).rejects.toThrow('audit unavailable');
    expect(await prisma.fileObject.findUnique({ where: { id: upload.file.id } })).toMatchObject({ status: 'QUARANTINED', deletedAt: null, version: 1 });
  });

  async function holdLock(lock: Prisma.Sql, beforeRelease?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    let unlock!: () => void;
    let acquired!: (pid: number) => void;
    const released = new Promise<void>((resolve) => { unlock = resolve; });
    const ready = new Promise<number>((resolve) => { acquired = resolve; });
    const holder = prisma.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw(lock);
      acquired(backend!.pid);
      await released;
      await beforeRelease?.(tx);
    }, { timeout: 15000 });
    return { pid: await ready, release: async () => { unlock(); await holder; } };
  }

  async function waitForBlocked(pid: number) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS waiting`;
      if (row!.waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Expected independently held PostgreSQL business lock was not awaited');
  }

  it.each(['session', 'disabled', 'security-version', 'organization', 'mfa-policy'] as const)('rechecks %s after waiting for the file lock', async (revocation) => {
    const upload = await uploaded();
    const held = await holdLock(Prisma.sql`SELECT id FROM file_objects WHERE id = ${upload.file.id}::uuid FOR UPDATE`);
    const pending = files.complete(context.actor, upload.file.id, 1, randomUUID(), randomUUID()).then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      await waitForBlocked(held.pid);
      if (revocation === 'session') await prisma.session.update({ where: { id: context.actor.sessionId }, data: { revokedAt: new Date() } });
      if (revocation === 'disabled') await prisma.user.update({ where: { id: context.actor.id }, data: { status: 'DISABLED' } });
      if (revocation === 'security-version') await prisma.user.update({ where: { id: context.actor.id }, data: { securityVersion: { increment: 1 } } });
      if (revocation === 'organization') await prisma.organization.update({ where: { id: context.organization.id }, data: { status: 'DISABLED' } });
      if (revocation === 'mfa-policy') {
        const role = await prisma.role.create({ data: { code: randomUUID(), name: 'MFA required', organizationId: context.organization.id, mfaRequired: true } });
        await prisma.userRole.create({ data: { roleId: role.id, userId: context.user.id, organizationId: context.organization.id } });
      }
    } finally { await held.release(); }
    expect(await pending).toMatchObject({ error: { response: { code: revocation === 'mfa-policy' ? 'AUTH_MFA_REQUIRED' : 'AUTH_SESSION_REQUIRED' } } });
    expect(await prisma.fileObject.findUnique({ where: { id: upload.file.id } })).toMatchObject({ version: 1, objectVersionId: null });
  });

  it('rechecks resource ownership after waiting for the domain lock', async () => {
    const upload = await uploaded();
    const held = await holdLock(Prisma.sql`SELECT id FROM problem_indexes WHERE id = ${context.problem.id}::uuid FOR UPDATE`,
      (tx) => tx.problemIndex.update({ where: { id: context.problem.id }, data: { ownerId: null } }));
    const pending = files.complete(context.actor, upload.file.id, 1, randomUUID(), randomUUID()).then((value) => ({ value }), (error: unknown) => ({ error }));
    try { await waitForBlocked(held.pid); } finally { await held.release(); }
    expect(await pending).toMatchObject({ error: { response: { code: 'FILE_RESOURCE_DENIED' } } });
    expect(await prisma.fileObject.findUnique({ where: { id: upload.file.id } })).toMatchObject({ version: 1, objectVersionId: null });
  });

  it('accepts an ordinary fully authenticated session without recent reauthentication', async () => {
    await prisma.user.update({ where: { id: context.user.id }, data: { mfaEnabled: true } });
    await prisma.session.update({ where: { id: context.session.id }, data: { mfaVerifiedAt: new Date(), reauthenticatedAt: new Date(Date.now() - 600000) } });
    const file = await completed();
    await scanWorker.processDue(100);
    await expect(files.download(context.actor, file.id, randomUUID())).resolves.toHaveProperty('url');
    await expect(files.deleteLogically(context.actor, file.id, 3, randomUUID())).resolves.toMatchObject({ status: 'DELETED' });
  });

  it('rechecks resource version after external HEAD without keeping the database transaction open', async () => {
    const upload = await uploaded();
    let resume!: () => void;
    let acquired!: () => void;
    const released = new Promise<void>((resolve) => { resume = resolve; });
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const delayed: ObjectStorage = {
      createUploadUrl: storage.createUploadUrl.bind(storage), readVersion: storage.readVersion.bind(storage), createDownloadUrl: storage.createDownloadUrl.bind(storage),
      head: async (key) => { const result = await storage.head(key); acquired(); await released; return result; },
    };
    const service = new FileLifecycleService(prisma, module.get(FilePolicyService), delayed, module.get(AuditLogService), module.get(FileResourceAccess));
    const pending = service.complete(context.actor, upload.file.id, 1, randomUUID(), randomUUID()).then((value) => ({ value }), (error: unknown) => ({ error }));
    await ready;
    try { await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { version: { increment: 1 } } }); }
    finally { resume(); }
    expect(await pending).toMatchObject({ error: { response: { code: 'CONCURRENCY_CONFLICT' } } });
  });

  it('does not revive deleted files when an actual scan finishes later', async () => {
    const file = await completed();
    let resume!: () => void;
    let acquired!: () => void;
    const released = new Promise<void>((resolve) => { resume = resolve; });
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const verifier = { verify: async (record: typeof file) => { const result = await module.get(FileVerificationService).verify(record); acquired(); await released; return result; } } as FileVerificationService;
    const delayed = new FileScanWorkerService(prisma, verifier, module.get(AuditLogService), () => new Date(Date.now() + 1000));
    const pending = delayed.processDue(1);
    await ready;
    try { await files.deleteLogically(context.actor, file.id, 2, randomUUID()); } finally { resume(); }
    await pending;
    expect(await prisma.fileObject.findUnique({ where: { id: file.id } })).toMatchObject({ status: 'DELETED', scanStatus: 'PENDING', verifiedSha256: null });
  });

  it('rejects an expired scan lease after a replacement worker publishes the real scan', async () => {
    const file = await completed();
    let now = new Date(Date.now() + 1000);
    let resume!: () => void;
    let acquired!: () => void;
    const released = new Promise<void>((resolve) => { resume = resolve; });
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const verifier = { verify: async (record: typeof file) => { const result = await module.get(FileVerificationService).verify(record); acquired(); await released; return result; } } as FileVerificationService;
    const stale = new FileScanWorkerService(prisma, verifier, module.get(AuditLogService), () => now);
    const pending = stale.processDue(1);
    await ready;
    try {
      now = new Date(now.getTime() + 120001);
      await new FileScanWorkerService(prisma, module.get(FileVerificationService), module.get(AuditLogService), () => now).processDue(1);
    } finally { resume(); }
    expect(await pending).toMatchObject({ processed: 0 });
    expect(await prisma.fileObject.findUnique({ where: { id: file.id } })).toMatchObject({ status: 'AVAILABLE', version: 3 });
    expect(await prisma.auditEvent.count({ where: { resourceId: file.id, action: 'ATTACHMENT_SCAN_CLEAN' } })).toBe(1);
  });

  it('keeps unavailable scanners quarantined through finite retries', async () => {
    const file = await completed();
    const previousHost = process.env.QMS_FILE_SCANNER_HOST;
    delete process.env.QMS_FILE_SCANNER_HOST;
    let now = new Date(Date.now() + 1000);
    try {
      const worker = new FileScanWorkerService(prisma, module.get(FileVerificationService), module.get(AuditLogService), () => now);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await worker.processDue(1);
        now = new Date(now.getTime() + 20000);
      }
    } finally { process.env.QMS_FILE_SCANNER_HOST = previousHost; }
    expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: file.id } })).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'FILE_SCANNER_CONFIGURATION_REQUIRED' });
    expect(await files.get(context.actor, file.id)).toMatchObject({ status: 'QUARANTINED', scanStatus: 'ERROR' });
  });

  it('requeues a terminal scan failure with the same object version and CAS', async () => {
    const file = await completed();
    const previousHost = process.env.QMS_FILE_SCANNER_HOST;
    delete process.env.QMS_FILE_SCANNER_HOST;
    let now = new Date(Date.now() + 1000);
    try {
      const worker = new FileScanWorkerService(prisma, module.get(FileVerificationService), module.get(AuditLogService), () => now);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await worker.processDue(1);
        now = new Date(now.getTime() + 20000);
      }
    } finally { process.env.QMS_FILE_SCANNER_HOST = previousHost; }
    const failed = await prisma.fileObject.findUniqueOrThrow({ where: { id: file.id } });
    expect(failed).toMatchObject({ scanStatus: 'ERROR', version: 2, objectVersionId: file.objectVersionId });
    const key = randomUUID();
    await expect(files.retryScan(context.actor, file.id, 2, key, randomUUID())).resolves.toMatchObject({ scanStatus: 'PENDING', version: 2 });
    await expect(files.retryScan(context.actor, file.id, 2, key, randomUUID())).resolves.toMatchObject({ scanStatus: 'PENDING', version: 2 });
    expect(await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: file.id } })).toMatchObject({ status: 'PENDING', attempts: 0, lastError: null });
    await expect(files.retryScan(context.actor, file.id, 1, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
    await expect(files.download(context.actor, file.id, randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_NOT_AVAILABLE' } });
    await scanWorker.processDue(1);
    expect(await files.get(context.actor, file.id)).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN', version: 3 });
    expect((await prisma.fileObject.findUniqueOrThrow({ where: { id: file.id } })).objectVersionId).toBe(file.objectVersionId);
    expect(await prisma.auditEvent.count({ where: { resourceId: file.id, action: 'ATTACHMENT_SCAN_RETRY_REQUESTED' } })).toBe(1);
  });

  it('does not restart a clean, rejected or deleted scan', async () => {
    const clean = await completed();
    await scanWorker.processDue(1);
    await expect(files.retryScan(context.actor, clean.id, 3, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_SCAN_RETRY_UNAVAILABLE' } });
    const rejected = await completed(bytes, 'text/plain', { sha256: 'b'.repeat(64) });
    await scanWorker.processDue(1);
    await expect(files.retryScan(context.actor, rejected.id, 3, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_SCAN_RETRY_UNAVAILABLE' } });
    const deleted = await completed();
    await files.deleteLogically(context.actor, deleted.id, 2, randomUUID());
    await expect(files.retryScan(context.actor, deleted.id, 3, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_SCAN_RETRY_UNAVAILABLE' } });
  });

  it('rolls back scan recovery if its audit entry cannot commit', async () => {
    const file = await completed();
    await prisma.fileObject.update({ where: { id: file.id }, data: { scanStatus: 'ERROR', scanReason: 'FILE_SCANNER_UNAVAILABLE' } });
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: file.id, eventType: 'FILE_SCAN_REQUESTED' } });
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'FAILED', attempts: 5, lastError: 'FILE_SCANNER_UNAVAILABLE' } });
    const audit = { record: async () => { throw new Error('audit unavailable'); } } as unknown as AuditLogService;
    const service = new FileLifecycleService(prisma, module.get(FilePolicyService), storage, audit, module.get(FileResourceAccess));
    await expect(service.retryScan(context.actor, file.id, 2, randomUUID(), randomUUID())).rejects.toThrow('audit unavailable');
    expect(await prisma.fileObject.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ scanStatus: 'ERROR', scanReason: 'FILE_SCANNER_UNAVAILABLE' });
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'FILE_SCANNER_UNAVAILABLE' });
  });

  it('does not publish scan failure after its lease expires waiting for a file lock', async () => {
    const file = await completed();
    let now = new Date(Date.now() + 1000);
    const worker = new FileScanWorkerService(prisma, { verify: async () => { throw new Error('FILE_SCANNER_UNAVAILABLE'); } } as unknown as FileVerificationService,
      module.get(AuditLogService), () => now);
    const held = await holdLock(Prisma.sql`SELECT id FROM file_objects WHERE id = ${file.id}::uuid FOR UPDATE`);
    const pending = worker.processDue(1);
    try {
      await waitForBlocked(held.pid);
      now = new Date(now.getTime() + 120001);
    } finally { await held.release(); }
    expect(await pending).toEqual({ processed: 0, retried: 0, failed: 0 });
    expect(await prisma.fileObject.findUnique({ where: { id: file.id } })).toMatchObject({ scanStatus: 'PENDING', scanReason: null, version: 2 });
    expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: file.id } })).toMatchObject({ status: 'PROCESSING', attempts: 0 });
    await new FileScanWorkerService(prisma, module.get(FileVerificationService), module.get(AuditLogService), () => now).processDue(1);
    expect(await files.get(context.actor, file.id)).toMatchObject({ status: 'AVAILABLE' });
  });

  it.each(['future', 'uncompleted'] as const)('fails a forged %s scan event without changing the file', async (kind) => {
    const file = kind === 'future' ? await completed() : await prisma.fileObject.findUniqueOrThrow({ where: { id: (await uploaded()).file.id } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: file.id } });
    const fileVersion = kind === 'future' ? file.version + 1 : 2;
    const event = await prisma.outboxEvent.create({ data: { eventKey: `file-scan:${file.id}:${fileVersion}`, aggregateType: 'FileObject', aggregateId: file.id,
      eventType: 'FILE_SCAN_REQUESTED', payload: { schemaVersion: 1, organizationId: file.organizationId, fileId: file.id, fileVersion } } });
    expect(await scanWorker.processDue(1)).toMatchObject({ processed: 0, retried: 1 });
    expect(await prisma.outboxEvent.findUnique({ where: { id: event.id } })).toMatchObject({ status: 'PENDING', lastError: 'FILE_SCAN_EVENT_INVALID', attempts: 1 });
    expect(await prisma.fileObject.findUnique({ where: { id: file.id } })).toEqual(file);
  });

  it.each(['runtime-first', 'upload-first'] as const)('uses the same domain lock order for attachment and upload: %s', async (order) => {
    const workflow = await timingFixture(prisma, organizations);
    const session = await prisma.session.create({ data: { userId: workflow.user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
    const problem = await prisma.problemIndex.update({ where: { id: workflow.problem.id }, data: { ownerId: workflow.user.id } });
    context = { organization: workflow.organization, user: workflow.user, session, problem,
      actor: { id: workflow.user.id, organizationId: workflow.organization.id, accountType: 'INTERNAL', sessionId: session.id },
      resource: { resourceType: 'NeutralEvidence', resourceId: problem.id } };
    const file = await completed();
    await scanWorker.processDue(100);
    const audit = module.get(AuditLogService);
    const outbox = new OutboxService(prisma);
    const runtime = new WorkflowRuntimeService(prisma, audit, outbox, new ProblemIndexService(prisma, new NumberingService(prisma), audit, outbox));
    const command = { actor: context.actor, organizationId: problem.organizationId, problemIndexId: problem.id, workflowVersionId: workflow.started.workflowVersionId,
      instanceId: workflow.started.instanceId, currentNodeId: workflow.started.currentNodeId, expectedVersion: workflow.started.version,
      expectedProblemVersion: workflow.started.problemVersion, action: 'SUBMIT' as const, idempotencyKey: randomUUID(), traceId: randomUUID() };
    await expect(runtime.submitAction({ ...command, idempotencyKey: randomUUID() }, undefined, async (tx) => {
      await files.assertAttachable(tx, context.actor, context.resource, [file.id]);
      await tx.problemIndex.update({ where: { id: problem.id }, data: { severity: 'HIGH' } });
      throw new Error('domain mutation rejected');
    })).rejects.toThrow('domain mutation rejected');
    expect(await prisma.problemIndex.findUnique({ where: { id: problem.id } })).toMatchObject({ severity: 'LOW', version: workflow.started.problemVersion });
    expect(await prisma.workflowInstance.findUnique({ where: { id: workflow.started.instanceId } })).toMatchObject({ version: 1 });
    let resume!: () => void;
    let acquired!: (pid: number) => void;
    const released = new Promise<void>((resolve) => { resume = resolve; });
    const ready = new Promise<number>((resolve) => { acquired = resolve; });
    async function gate(tx: Prisma.TransactionClient) {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      acquired(backend!.pid);
      await released;
    }
    const adapter = new NeutralFileResourceAdapter();
    let gated = false;
    const uploadService = new FileLifecycleService(prisma, module.get(FilePolicyService), storage, audit, new FileResourceAccess([{
      resourceType: adapter.resourceType,
      authorizeAndLock: async (tx, actor, resource) => {
        const grant = await adapter.authorizeAndLock(tx, actor, resource);
        if (order === 'upload-first' && !gated) { gated = true; await gate(tx); }
        return grant;
      },
    }]));
    const submit = () => runtime.submitAction(command, undefined, async (tx) => {
      if (order === 'runtime-first') await gate(tx);
      await files.assertAttachable(tx, context.actor, context.resource, [file.id]);
    });
    const upload = () => uploadService.initializeUpload(context.actor, input(), randomUUID(), randomUUID());
    const first = (order === 'runtime-first' ? submit() : upload()).then((value) => ({ value }), (error: unknown) => ({ error }));
    const pid = await ready;
    const second = (order === 'runtime-first' ? upload() : submit()).then((value) => ({ value }), (error: unknown) => ({ error }));
    try { await waitForBlocked(pid); } finally { resume(); }
    expect(await first).toHaveProperty('value');
    expect(await second).toHaveProperty('value');
    expect(await prisma.workflowInstance.findUnique({ where: { id: workflow.started.instanceId } })).toMatchObject({ version: 2 });
    expect(await prisma.fileObject.findUnique({ where: { id: file.id } })).toMatchObject({ status: 'AVAILABLE', version: 3 });
  });

  it('publishes one audited result across two real workers and rolls back a failed scan audit', async () => {
    const file = await completed();
    const failing = new FileScanWorkerService(prisma, module.get(FileVerificationService), { record: async () => { throw new Error('audit unavailable'); } } as unknown as AuditLogService, () => new Date(Date.now() + 1000));
    await expect(failing.processDue(1)).rejects.toThrow('audit unavailable');
    expect(await prisma.fileObject.findUnique({ where: { id: file.id } })).toMatchObject({ status: 'QUARANTINED', scanStatus: 'PENDING', version: 2, verifiedSha256: null });
    await prisma.outboxEvent.updateMany({ where: { aggregateId: file.id }, data: { processingAt: new Date(Date.now() - 120001) } });
    const results = await Promise.all([scanWorker.processDue(1), scanWorker.processDue(1)]);
    expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(1);
    expect(await prisma.fileObject.findUnique({ where: { id: file.id } })).toMatchObject({ status: 'AVAILABLE', version: 3 });
    expect(await prisma.auditEvent.count({ where: { resourceId: file.id, action: 'ATTACHMENT_SCAN_CLEAN' } })).toBe(1);
  });

  it('exposes only owned valid scan failures to controlled outbox retry', async () => {
    const file = await completed();
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: file.id } });
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'FAILED', attempts: 5, lastError: 'sensitive-engine-output' } });
    const role = await prisma.role.create({ data: { code: randomUUID(), name: 'File operations', organizationId: context.organization.id } });
    for (const code of ['outbox:read', 'outbox:retry']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { roleId: role.id, userId: context.user.id, organizationId: context.organization.id } });
    await prisma.session.update({ where: { id: context.session.id }, data: { mfaVerifiedAt: new Date(), reauthenticatedAt: new Date() } });
    const admin = new OutboxAdministrationService(prisma, module.get(AuditLogService));
    const page = await admin.list(context.actor, {});
    expect(page).toMatchObject({ total: 1, items: [{ id: event.id, eventType: 'FILE_SCAN_REQUESTED' }] });
    expect(JSON.stringify(page)).not.toMatch(/sensitive-engine|objectVersion|payload/);
    await admin.retry(context.actor, event.id, context.organization.id, randomUUID());
    await scanWorker.processDue(100);
    expect(await files.get(context.actor, file.id)).toMatchObject({ status: 'AVAILABLE' });
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'FAILED' } });
    expect(await admin.list(context.actor, {})).toEqual({ total: 0, items: [] });
    await expect(admin.retry(context.actor, event.id, context.organization.id, randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  it('enforces real HTTP cookies, CSRF and strict server-owned fields through the complete lifecycle', async () => {
    const application = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(FILE_RESOURCE_ADAPTERS).useValue([new NeutralFileResourceAdapter()]).compile();
    const app = application.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    try {
      const token = await app.get(SessionService).create(context.actor.id, prisma, { mfaVerified: true });
      const cookie = `qms_session=${token}; qms_csrf=file-csrf`;
      const post = (path: string) => request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', 'file-csrf').set('Idempotency-Key', randomUUID());
      await request(app.getHttpServer()).get(`/api/v1/files/${randomUUID()}`).expect(401);
      await request(app.getHttpServer()).post('/api/v1/files/uploads').send(input()).expect(403);
      await request(app.getHttpServer()).post('/api/v1/files/uploads').set('Cookie', cookie).send(input()).expect(403);
      for (const fields of [{ organizationId: context.organization.id }, { uploadedById: context.user.id }, { objectKey: randomUUID() }, { clean: true }, { sizeBytes: 0 }, { sizeBytes: 1.5 }, { originalName: '../unsafe' }, { sha256: 'invalid' }]) {
        await post('/api/v1/files/uploads').send({ ...input(), ...fields }).expect(400);
      }
      await post('/api/v1/files/uploads').send({ ...input(), resourceType: 'Unregistered' }).expect(403);
      const initialized = await post('/api/v1/files/uploads').send(input()).expect(201);
      const path = `/api/v1/files/${initialized.body.file.id}`;
      expect((await fetch(initialized.body.uploadUrl, { method: 'PUT', headers: initialized.body.headers, body: bytes })).status).toBe(200);
      await post(`${path}/complete`).send({ expectedVersion: 1, clean: true }).expect(400);
      await post(`${path}/complete`).send({ expectedVersion: 0 }).expect(400);
      const complete = await post(`${path}/complete`).send({ expectedVersion: 1 }).expect(202);
      expect(complete.body).toMatchObject({ status: 'QUARANTINED', scanStatus: 'PENDING' });
      expect(complete.body).not.toHaveProperty('objectVersionId');
      await post(`${path}/download`).send({}).expect(409);
      await prisma.fileObject.update({ where: { id: initialized.body.file.id }, data: { scanStatus: 'ERROR', scanReason: 'FILE_SCANNER_UNAVAILABLE' } });
      await prisma.outboxEvent.updateMany({ where: { aggregateId: initialized.body.file.id, eventType: 'FILE_SCAN_REQUESTED' }, data: { status: 'FAILED', attempts: 5 } });
      await post(`${path}/retry-scan`).send({ expectedVersion: 1 }).expect(409);
      await post(`${path}/retry-scan`).send({ expectedVersion: 2 }).expect(202);
      await scanWorker.processDue(100);
      await request(app.getHttpServer()).get(path).set('Cookie', cookie).expect(200);
      await post(`${path}/download`).send({ actor: context.actor.id }).expect(400);
      const download = await post(`${path}/download`).send({}).expect(201);
      expect(Buffer.from(await (await fetch(download.body.url)).arrayBuffer())).toEqual(bytes);
      await post(`${path}/delete`).send({ expectedVersion: 2 }).expect(409);
      await post(`${path}/delete`).send({ expectedVersion: 3 }).expect(201);
      await post(`${path}/download`).send({}).expect(409);
    } finally { await app.close(); }
  });
});
