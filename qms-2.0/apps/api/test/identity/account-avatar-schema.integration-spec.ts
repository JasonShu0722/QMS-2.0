import { createHash, randomUUID } from 'node:crypto';
import { accountDeliveryFixture, type AccountDeliveryFixture } from './account-delivery-fixture.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import request from 'supertest';
import { jest } from '@jest/globals';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AccountAvatarService } from '../../src/modules/identity/account-avatar.service.js';
import { neutralFileFixture } from '../file-management/file-fixture.js';

describe('private account avatar on PostgreSQL, object storage and ClamAV', () => {
  let context: AccountDeliveryFixture;
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK9sAAAAASUVORK5CYII=', 'base64');
  beforeAll(async () => { context = await accountDeliveryFixture(); });
  const setAvatar = (fileId: string | null, expectedVersion: number, key = randomUUID()) => request(context.app.getHttpServer()).patch('/api/v1/me/avatar').set('Cookie', context.cookie).set('x-csrf-token', context.csrf).set('Idempotency-Key', key).send({ fileId, expectedVersion });
  afterAll(async () => {
    if (!context) return;
    const ids = (await context.prisma.fileObject.findMany({ where: { organizationId: context.organization.id } })).map(({ id }) => id);
    await context.prisma.outboxEvent.deleteMany({ where: { aggregateType: 'FileObject', aggregateId: { in: ids } } });
    await context.app.close();
  });

  it('authorizes only the owner and keeps genuine PNG quarantined until the real Worker scans it', async () => {
    const tokenHash = createHash('sha256').update(context.cookie.match(/qms_session=([^;]+)/)![1]!).digest('hex');
    const session = await context.prisma.session.findUniqueOrThrow({ where: { tokenHash } });
    const actor = { id: context.actor.id, organizationId: context.organization.id, accountType: 'INTERNAL' as const, sessionId: session.id };
    const files = context.app.get(FileLifecycleService);
    const input = { resourceType: 'ACCOUNT_AVATAR', resourceId: actor.id, originalName: 'avatar.png', contentType: 'image/png', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    const reservation = await files.initializeUpload(actor, input, randomUUID(), randomUUID());
    expect(reservation.file).toMatchObject({ status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD' });
    const foreign = await context.target();
    await expect(files.initializeUpload(actor, { ...input, resourceId: foreign.id }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
    await expect(files.initializeUpload(actor, { ...input, contentType: 'text/plain' }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_MIME_NOT_ALLOWED' } });
    await expect(files.initializeUpload(actor, { ...input, sizeBytes: 2 * 1024 * 1024 + 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_TOO_LARGE' } });
    expect((await fetch(reservation.uploadUrl, { method: 'PUT', headers: reservation.headers, body: bytes })).status).toBe(200);
    await files.complete(actor, reservation.file.id, 1, randomUUID(), randomUUID());
    expect((await setAvatar(reservation.file.id, 1)).body.code).toBe('FILE_NOT_AVAILABLE');
    await expect(files.download(actor, reservation.file.id, randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_NOT_AVAILABLE' } });
    await context.app.get(FileScanWorkerService).processDue(100);
    expect(await files.get(actor, reservation.file.id)).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN' });
    expect((await fetch((await files.download(actor, reservation.file.id, randomUUID())).url)).status).toBe(200);
    const key = randomUUID();
    const attached = await setAvatar(reservation.file.id, 1, key);
    expect(attached.status).toBe(200);
    expect(attached.body).toMatchObject({ avatarFileId: reservation.file.id, avatarVersion: 2 });
    expect(JSON.stringify(attached.body)).not.toMatch(/objectKey|objectVersionId|https?:/);
    expect((await setAvatar(reservation.file.id, 1, key)).body.avatarVersion).toBe(2);
    expect((await setAvatar(null, 1, key)).body.code).toBe('IDEMPOTENCY_REPLAY');
    expect((await setAvatar(null, 1)).body.code).toBe('CONCURRENCY_CONFLICT');
    const failure = jest.spyOn(context.app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('avatar audit failure'));
    expect((await setAvatar(null, 2)).status).toBe(500);
    failure.mockRestore();
    expect((await context.prisma.user.findUniqueOrThrow({ where: { id: actor.id } })).avatarFileId).toBe(reservation.file.id);
    expect((await setAvatar(null, 2)).body).toMatchObject({ avatarFileId: null, avatarVersion: 3 });
    expect((await files.get(actor, reservation.file.id)).status).toBe('AVAILABLE');
    await context.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(files.download(actor, reservation.file.id, randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
  });

  it.each(['INTERNAL', 'SUPPLIER'] as const)('keeps %s owners isolated from other users, organizations and account types', async (accountType) => {
    const fixture = await neutralFileFixture(context.prisma, accountType);
    const outsider = await neutralFileFixture(context.prisma, accountType === 'INTERNAL' ? 'SUPPLIER' : 'INTERNAL');
    const files = context.app.get(FileLifecycleService);
    const body = { resourceType: 'ACCOUNT_AVATAR', resourceId: fixture.user.id, originalName: 'private.png', contentType: 'image/png', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    const reservation = await files.initializeUpload(fixture.actor, body, randomUUID(), randomUUID());
    await expect(files.get(outsider.actor, reservation.file.id)).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
    await expect(files.initializeUpload(fixture.actor, { ...body, resourceId: outsider.user.id }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
    await expect(files.get({ ...fixture.actor, organizationId: outsider.organization.id }, reservation.file.id)).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
    expect((await fetch(reservation.uploadUrl, { method: 'PUT', headers: reservation.headers, body: bytes })).status).toBe(200);
    await files.complete(fixture.actor, reservation.file.id, 1, randomUUID(), randomUUID());
    await context.app.get(FileScanWorkerService).processDue(100);
    expect(await context.app.get(AccountAvatarService).update(fixture.actor, { fileId: reservation.file.id, expectedVersion: 1 }, randomUUID(), randomUUID())).toMatchObject({ avatarFileId: reservation.file.id, avatarVersion: 2 });
    await expect(context.app.get(AccountAvatarService).update(outsider.actor, { fileId: reservation.file.id, expectedVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
    const replacement = await files.initializeUpload(fixture.actor, { ...body, originalName: 'replacement.png' }, randomUUID(), randomUUID());
    expect((await fetch(replacement.uploadUrl, { method: 'PUT', headers: replacement.headers, body: bytes })).status).toBe(200);
    await files.complete(fixture.actor, replacement.file.id, 1, randomUUID(), randomUUID());
    await context.app.get(FileScanWorkerService).processDue(100);
    expect(await context.app.get(AccountAvatarService).update(fixture.actor, { fileId: replacement.file.id, expectedVersion: 2 }, randomUUID(), randomUUID())).toMatchObject({ avatarFileId: replacement.file.id, avatarVersion: 3 });
    expect((await files.get(fixture.actor, reservation.file.id)).status).toBe('AVAILABLE');
  });

  it('quarantines actual MIME mismatches and a real ClamAV diagnostic, and never attaches either', async () => {
    const fixture = await neutralFileFixture(context.prisma);
    const files = context.app.get(FileLifecycleService);
    const diagnostic = Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
    for (const content of [Buffer.from('not a JPEG'), diagnostic]) {
      const reservation = await files.initializeUpload(fixture.actor, { resourceType: 'ACCOUNT_AVATAR', resourceId: fixture.user.id, originalName: 'untrusted.jpg', contentType: 'image/jpeg', sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }, randomUUID(), randomUUID());
      expect((await fetch(reservation.uploadUrl, { method: 'PUT', headers: reservation.headers, body: content })).status).toBe(200);
      await files.complete(fixture.actor, reservation.file.id, 1, randomUUID(), randomUUID());
      await context.app.get(FileScanWorkerService).processDue(100);
      expect(await files.get(fixture.actor, reservation.file.id)).toMatchObject({ status: 'QUARANTINED', scanStatus: 'REJECTED' });
      const scanned = await context.prisma.fileObject.findUniqueOrThrow({ where: { id: reservation.file.id } });
      expect(scanned.scannerEngine).toMatch(/^ClamAV /);
      expect(scanned.scanReason).toBe(content === diagnostic ? 'FILE_MALWARE_DETECTED' : 'FILE_CONTENT_TYPE_MISMATCH');
      await expect(context.app.get(AccountAvatarService).update(fixture.actor, { fileId: reservation.file.id, expectedVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_NOT_AVAILABLE' } });
    }
  });

  it('serializes concurrent reference changes with one CAS winner and replays only the exact request', async () => {
    const fixture = await neutralFileFixture(context.prisma);
    const avatar = context.app.get(AccountAvatarService);
    const attempts = await Promise.allSettled([avatar.update(fixture.actor, { fileId: null, expectedVersion: 1 }, randomUUID(), randomUUID()), avatar.update(fixture.actor, { fileId: null, expectedVersion: 1 }, randomUUID(), randomUUID())]);
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toMatchObject([{ reason: { response: { code: 'CONCURRENCY_CONFLICT' } } }]);
    await expect(avatar.update(fixture.actor, { fileId: null, expectedVersion: 2 }, undefined, randomUUID())).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
  });

  it('audits rejected avatar writes after rollback without changing the reference or successful receipts', async () => {
    const fixture = await neutralFileFixture(context.prisma);
    const foreign = await neutralFileFixture(context.prisma);
    const files = context.app.get(FileLifecycleService);
    const avatar = context.app.get(AccountAvatarService);
    const body = { resourceType: 'ACCOUNT_AVATAR', resourceId: fixture.user.id, originalName: 'pending.png', contentType: 'image/png', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    const pending = await files.initializeUpload(fixture.actor, body, randomUUID(), randomUUID());
    const foreignFile = await files.initializeUpload(foreign.actor, { ...body, resourceId: foreign.user.id }, randomUUID(), randomUUID());
    const key = randomUUID();
    await avatar.update(fixture.actor, { fileId: null, expectedVersion: 1 }, key, randomUUID());
    const cases = [
      { fileId: foreignFile.file.id, expectedVersion: 2, code: 'FILE_RESOURCE_DENIED', key: randomUUID() },
      { fileId: pending.file.id, expectedVersion: 2, code: 'FILE_NOT_AVAILABLE', key: randomUUID() },
      { fileId: null, expectedVersion: 1, code: 'CONCURRENCY_CONFLICT', key: randomUUID() },
      { fileId: null, expectedVersion: 2, code: 'IDEMPOTENCY_REPLAY', key },
    ];
    for (const rejected of cases) {
      const traceId = randomUUID();
      await expect(avatar.update(fixture.actor, { fileId: rejected.fileId, expectedVersion: rejected.expectedVersion }, rejected.key, traceId)).rejects.toMatchObject({ response: { code: rejected.code } });
      expect(await context.prisma.auditEvent.findFirst({ where: { actorUserId: fixture.user.id, traceId, action: 'ACTION_REJECTED' } })).toMatchObject({ outcome: 'DENIED', metadata: { reasonCode: rejected.code } });
      expect(await context.prisma.user.findUniqueOrThrow({ where: { id: fixture.user.id } })).toMatchObject({ avatarFileId: null, avatarVersion: 2 });
      expect(await context.prisma.accountAvatarReceipt.count({ where: { actorUserId: fixture.user.id } })).toBe(1);
    }
  });

  it('can replace an avatar more than ten times while preserving old CLEAN objects', async () => {
    const fixture = await neutralFileFixture(context.prisma);
    const files = context.app.get(FileLifecycleService);
    const avatar = context.app.get(AccountAvatarService);
    const ids: string[] = [];
    for (let index = 0; index < 11; index += 1) {
      const upload = await files.initializeUpload(fixture.actor, { resourceType: 'ACCOUNT_AVATAR', resourceId: fixture.user.id, originalName: `avatar-${index}.png`, contentType: 'image/png', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, randomUUID(), randomUUID());
      ids.push(upload.file.id);
      expect((await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: bytes })).status).toBe(200);
      await files.complete(fixture.actor, upload.file.id, 1, randomUUID(), randomUUID());
      await context.app.get(FileScanWorkerService).processDue(100);
      await avatar.update(fixture.actor, { fileId: upload.file.id, expectedVersion: index + 1 }, randomUUID(), randomUUID());
    }
    expect(await context.prisma.fileObject.count({ where: { id: { in: ids }, status: 'AVAILABLE', scanStatus: 'CLEAN', deletedAt: null } })).toBe(11);
    expect(await context.prisma.user.findUniqueOrThrow({ where: { id: fixture.user.id } })).toMatchObject({ avatarFileId: ids[10], avatarVersion: 12 });
  }, 30_000); // Eleven real upload/scan cycles exceed the unit-test default on the local container runtime.

  it('still rejects an eleventh unfinished avatar upload at the unchanged resource quota', async () => {
    const fixture = await neutralFileFixture(context.prisma);
    const files = context.app.get(FileLifecycleService);
    const body = { resourceType: 'ACCOUNT_AVATAR', resourceId: fixture.user.id, originalName: 'pending.png', contentType: 'image/png', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    for (let index = 0; index < 10; index += 1) await files.initializeUpload(fixture.actor, body, randomUUID(), randomUUID());
    await expect(files.initializeUpload(fixture.actor, body, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'FILE_QUOTA_EXCEEDED' } });
  });
});
