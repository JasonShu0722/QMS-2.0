import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import type { FileObject, Prisma } from '../../src/generated/prisma/client.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FilePolicyService } from '../../src/modules/file-management/file-policy.service.js';
import { FileResourceAccess, type FileActor } from '../../src/modules/file-management/file-resource-access.js';

function setup() {
  const actor: FileActor = { id: randomUUID(), organizationId: randomUUID(), accountType: 'INTERNAL', sessionId: randomUUID() };
  const resource = { resourceType: 'process-eight-d', resourceId: randomUUID() };
  const user = { ...actor, status: 'ACTIVE', mustChangePassword: false, securityVersion: 1,
    organization: { status: 'ACTIVE' }, mfaEnabled: false, mfaPreference: 'DISABLED', mfaRequirementOverride: null };
  const session = { securityVersion: 1, mfaVerifiedAt: null as Date | null };
  const file = { id: randomUUID(), organizationId: actor.organizationId, ...resource, originalName: 'evidence.png',
    contentType: 'image/png', sizeBytes: 12n, sha256: 'a'.repeat(64), status: 'AVAILABLE', scanStatus: 'CLEAN', scanReason: null,
    objectKey: randomUUID(), objectVersionId: 'immutable-v1', version: 3, scannedAt: new Date('2026-10-25T08:00:00Z'),
    uploadCompletedAt: new Date('2026-10-25T07:59:00Z'), scannerEngine: 'ClamAV', verifiedSha256: 'a'.repeat(64),
    verifiedContentType: 'image/png', verifiedSizeBytes: 12n, deletedAt: null,
    uploadExpiresAt: new Date('2026-10-25T08:10:00Z'), retainUntil: new Date('2026-11-01T08:00:00Z') } as FileObject;
  const queries: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async (query: TemplateStringsArray, ..._values: unknown[]) => {
      const sql = query.join('?'); queries.push(sql);
      // A report/domain lock is already held: authentication must not acquire late user/session locks.
      if (/FROM (users|sessions|organizations).*FOR /s.test(sql)) throw new Error('LATE_AUTHENTICATION_LOCK');
      return sql.startsWith('SHOW') ? [{ transaction_isolation: 'read committed' }] : [];
    }),
    user: { findUnique: jest.fn(async () => user) },
    organization: { findUnique: jest.fn(async () => user.organization) },
    session: { findFirst: jest.fn(async () => session) },
    userRole: { findMany: jest.fn(async () => []) }, userPosition: { findMany: jest.fn(async () => []) },
    fileObject: { findMany: jest.fn(async () => [structuredClone(file)]) },
  };
  const grant = { organizationId: actor.organizationId, version: 2 };
  const adapter = { resourceType: resource.resourceType,
    authorizeAndLock: jest.fn(async (_tx: unknown, _actor: FileActor, _resource: typeof resource, _action: string) => grant) };
  const audit = { record: jest.fn(async () => undefined) };
  // Boundary doubles are unit evidence only; real locks/storage are verified by the parent integration run.
  const service = new FileLifecycleService({} as never, new FilePolicyService(), {} as never, audit as never, new FileResourceAccess([adapter]));
  const groups = [{ resource, fileIds: [file.id] }];
  const read = (traceId?: string) => service.readReportEvidence(tx as unknown as Prisma.TransactionClient, actor, groups, traceId);
  return { service, tx, actor, resource, user, session, file, groups, grant, adapter, audit, queries, read };
}

describe('server-owned report attachment references', () => {
  it('has an explicit report evidence reader', () => {
    expect(FileLifecycleService.prototype).toHaveProperty('readReportEvidence');
  });

  it('returns only authorized verified immutable references without late authentication locks or storage access', async () => {
    const s = setup();
    expect(await s.read()).toEqual([expect.objectContaining({ id: s.file.id, objectKey: s.file.objectKey,
      objectVersionId: 'immutable-v1', sizeBytes: 12, downloadable: true, scannedAt: s.file.scannedAt!.toISOString() })]);
    expect(s.adapter.authorizeAndLock).toHaveBeenCalledWith(s.tx, s.actor, s.resource, 'read');
    expect(s.tx.session.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: s.actor.sessionId, userId: s.actor.id, revokedAt: null, expiresAt: { gt: expect.any(Date) }, securityVersion: 1,
    }) }));
    expect(s.queries.some(sql => sql.includes('FROM file_objects') && sql.includes('FOR UPDATE'))).toBe(true);
    expect(s.audit.record).not.toHaveBeenCalled();
  });

  it('records each attachment download authorization in the caller transaction only when requested', async () => {
    const s = setup(); await s.read('report-trace');
    expect(s.audit.record).toHaveBeenCalledTimes(1);
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ organizationId: s.actor.organizationId,
      actorUserId: s.actor.id, action: 'ATTACHMENT_DOWNLOAD_AUTHORIZED', resourceId: s.file.id, traceId: 'report-trace' }), s.tx);
    expect(JSON.stringify(s.audit.record.mock.calls)).not.toContain(s.file.objectKey);
  });

  it.each(['organizationId', 'resourceType', 'resourceId'] as const)('rejects a file belonging to another %s', async key => {
    const s = setup(); s.file[key] = randomUUID();
    await expect(s.read('trace')).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
    expect(s.audit.record).not.toHaveBeenCalled();
  });

  it('rejects missing references and unregistered resources', async () => {
    const s = setup(); s.tx.fileObject.findMany.mockResolvedValue([]);
    await expect(s.read()).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
    s.resource.resourceType = 'unregistered';
    await expect(s.read()).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
  });

  it('rechecks file ownership after acquiring file locks', async () => {
    const s = setup(); s.tx.fileObject.findMany.mockResolvedValueOnce([structuredClone(s.file)]);
    s.file.resourceId = randomUUID();
    await expect(s.read()).rejects.toMatchObject({ response: { code: 'FILE_RESOURCE_DENIED' } });
  });

  it('revalidates actual adapter permission instead of trusting a previous grant', async () => {
    const s = setup();
    s.adapter.authorizeAndLock.mockResolvedValueOnce({ ...s.grant }).mockRejectedValueOnce(new Error('DOMAIN_READ_DENIED'));
    await expect(s.read('trace')).rejects.toThrow('DOMAIN_READ_DENIED');
    expect(s.audit.record).not.toHaveBeenCalled();
  });

  it('rejects a resource version changed during final authorization', async () => {
    const s = setup();
    s.adapter.authorizeAndLock.mockResolvedValueOnce({ ...s.grant }).mockResolvedValueOnce({ ...s.grant, version: 3 });
    await expect(s.read('trace')).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(s.audit.record).not.toHaveBeenCalled();
  });

  it('orders resource and file locks independently of caller selection order', async () => {
    const s = setup();
    const resource = { ...s.resource, resourceId: randomUUID() };
    const second = { ...s.file, id: randomUUID(), resourceId: resource.resourceId };
    s.groups.push({ resource, fileIds: [second.id] });
    s.tx.fileObject.findMany.mockResolvedValue([s.file, second]);
    await s.read();
    const calls = s.adapter.authorizeAndLock.mock.calls as [unknown, FileActor, typeof resource, string][];
    const resourceIds = calls.map(call => call[2].resourceId);
    expect(resourceIds).toEqual([...s.groups.map(group => group.resource.resourceId).sort(), ...s.groups.map(group => group.resource.resourceId).sort()]);
    const rawCalls = s.tx.$queryRaw.mock.calls as [TemplateStringsArray, ...unknown[]][];
    const fileLocks = rawCalls.filter(call => call[0].join('').includes('FROM file_objects'));
    expect(fileLocks.map(call => call[1])).toEqual([s.file.id, second.id].sort());
  });

  it.each([
    { status: 'QUARANTINED' }, { status: 'DELETED' }, { scanStatus: 'PENDING' }, { scanStatus: 'REJECTED' },
    { objectVersionId: null }, { objectVersionId: 'null' }, { objectVersionId: '' }, { objectVersionId: 'x'.repeat(1025) },
    { objectKey: 'caller-chosen/path.png' }, { objectKey: '10000000-0000-1000-8000-000000000001' },
    { verifiedSha256: 'b'.repeat(64) }, { sha256: 'bad', verifiedSha256: 'bad' },
    { verifiedContentType: 'text/plain' }, { verifiedSizeBytes: 13n }, { sizeBytes: 0n, verifiedSizeBytes: 0n },
    { sizeBytes: 26_214_401n, verifiedSizeBytes: 26_214_401n }, { scannedAt: null }, { scannedAt: new Date('invalid') },
    { scannedAt: new Date('2026-10-25T07:58:00Z') }, { uploadCompletedAt: null }, { scannerEngine: null }, { deletedAt: new Date() },
  ])('rejects unavailable or unverified metadata: %p', async patch => {
    const s = setup(); Object.assign(s.file, patch);
    await expect(s.read('trace')).rejects.toMatchObject({ response: { code: 'FILE_NOT_AVAILABLE' } });
    expect(s.audit.record).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'DISABLED' }, { organizationId: randomUUID() }, { accountType: 'SUPPLIER' },
    { mustChangePassword: true }, { organization: { status: 'DISABLED' } },
  ])('validates the actual user, not merely caller identity: %p', async patch => {
    const s = setup(); Object.assign(s.user, patch);
    await expect(s.read()).rejects.toMatchObject({ status: expect.any(Number) });
  });

  it('requires an active version-matching session even for a permissive registered adapter', async () => {
    const s = setup(); s.tx.session.findFirst.mockResolvedValue(null as never);
    await expect(s.read()).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
    expect(s.audit.record).not.toHaveBeenCalled();
  });

  it('requires current MFA and does not trust an MFA flag on the actor', async () => {
    const s = setup(); Object.assign(s.user, { mfaRequirementOverride: true });
    await expect(s.read()).rejects.toMatchObject({ response: { code: 'AUTH_MFA_REQUIRED' } });
  });

  it('allows current verified MFA and requires authentication even for an empty batch', async () => {
    const s = setup(); Object.assign(s.user, { mfaRequirementOverride: true }); s.session.mfaVerifiedAt = new Date();
    await expect(s.read()).resolves.toHaveLength(1);
    s.groups.length = 0; s.tx.fileObject.findMany.mockResolvedValue([]); s.tx.session.findFirst.mockResolvedValue(null as never);
    await expect(s.read()).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
  });

  it('rejects duplicate, oversized and malformed server-owned selections', async () => {
    const s = setup(); s.groups[0]!.fileIds.push(s.file.id);
    await expect(s.read()).rejects.toMatchObject({ response: { code: 'FILE_UPLOAD_INVALID' } });
    s.groups[0]!.fileIds = Array.from({ length: 101 }, () => randomUUID());
    await expect(s.read()).rejects.toMatchObject({ response: { code: 'FILE_UPLOAD_INVALID' } });
    s.groups[0]!.fileIds = ['not-a-uuid'];
    await expect(s.read()).rejects.toMatchObject({ response: { code: 'FILE_UPLOAD_INVALID' } });
    s.groups[0]!.fileIds = [s.file.id]; s.groups.push(s.groups[0]!);
    await expect(s.read()).rejects.toMatchObject({ response: { code: 'FILE_UPLOAD_INVALID' } });
  });

  it('rejects unsupported transaction isolation', async () => {
    const s = setup(); s.tx.$queryRaw.mockResolvedValue([{ transaction_isolation: 'repeatable read' }]);
    await expect(s.read()).rejects.toMatchObject({ response: { code: 'WORKFLOW_TRANSACTION_ISOLATION_UNSUPPORTED' } });
  });
});
