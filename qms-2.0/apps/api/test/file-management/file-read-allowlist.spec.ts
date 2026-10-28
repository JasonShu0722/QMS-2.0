import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import type { FileObject, Prisma } from '../../src/generated/prisma/client.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FilePolicyService } from '../../src/modules/file-management/file-policy.service.js';
import { FileResourceAccess, type FileActor, type FileResourceAction, type FileResourceGrant } from '../../src/modules/file-management/file-resource-access.js';

function setup() {
  const actor: FileActor = { id: randomUUID(), organizationId: randomUUID(), accountType: 'INTERNAL', sessionId: randomUUID() };
  const resource = { resourceType: 'DisclosureStaging', resourceId: randomUUID() };
  const user = { ...actor, status: 'ACTIVE', mustChangePassword: false, securityVersion: 1,
    organization: { status: 'ACTIVE' }, mfaEnabled: false, mfaPreference: 'DISABLED', mfaRequirementOverride: null };
  const file = { id: randomUUID(), organizationId: actor.organizationId, ...resource, originalName: 'publication.txt',
    contentType: 'text/plain', sizeBytes: 12n, sha256: 'a'.repeat(64), status: 'AVAILABLE', scanStatus: 'CLEAN', scanReason: null,
    objectKey: randomUUID(), objectVersionId: 'immutable-v1', version: 3, resourceVersion: 2,
    scannedAt: new Date('2026-10-25T08:00:00Z'), uploadCompletedAt: new Date('2026-10-25T07:59:00Z'), scannerEngine: 'ClamAV',
    verifiedSha256: 'a'.repeat(64), verifiedContentType: 'text/plain', verifiedSizeBytes: 12n, deletedAt: null,
    uploadExpiresAt: new Date('2026-10-25T08:10:00Z'), retainUntil: new Date('2026-11-01T08:00:00Z') } as FileObject;
  const hidden = { ...file, id: randomUUID(), originalName: 'internal.txt' };
  const records = [hidden, file];
  const queries: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async (query: TemplateStringsArray) => {
      const sql = query.join('?'); queries.push(sql);
      return sql.startsWith('SHOW') ? [{ transaction_isolation: 'read committed' }] : [];
    }),
    user: { findUnique: jest.fn(async () => user) },
    organization: { findUnique: jest.fn(async () => user.organization) },
    session: { findFirst: jest.fn(async () => ({ securityVersion: 1, mfaVerifiedAt: null })) },
    userRole: { findMany: jest.fn(async () => []) }, userPosition: { findMany: jest.fn(async () => []) },
    fileObject: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => records.find(row => row.id === where.id) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => structuredClone(records.find(row => row.id === where.id)!)),
      findMany: jest.fn(async ({ where, take }: { where: { id?: { in: string[] } }; take?: number }) => records
        .filter(row => !where.id || where.id.in.includes(row.id)).slice(0, take).map(row => structuredClone(row))),
    },
  };
  // Boundary doubles exercise the real access/lifecycle code; they do not prove database locking.
  const grant: FileResourceGrant & { readableFileIds?: readonly string[] } = { organizationId: actor.organizationId, version: 2 };
  const adapter = { resourceType: resource.resourceType,
    authorizeAndLock: jest.fn(async (_tx: Prisma.TransactionClient, _actor: FileActor, _resource: typeof resource, _action: FileResourceAction) => grant) };
  const resources = new FileResourceAccess([adapter]);
  const prisma = { $transaction: async <T>(work: (transaction: Prisma.TransactionClient) => Promise<T>) => work(tx as unknown as Prisma.TransactionClient) };
  const audit = { record: jest.fn(async () => undefined) };
  const storage = { createDownloadUrl: jest.fn(async () => 'https://storage.invalid/signed') };
  const service = new FileLifecycleService(prisma as never, new FilePolicyService({ maxFiles: 1 }), storage as never, audit as never, resources);
  const groups = (id = file.id) => [{ resource, fileIds: [id] }];
  const readers = {
    get: () => service.get(actor, file.id),
    evidence: () => service.readEvidence(tx as unknown as Prisma.TransactionClient, actor, groups()),
    report: () => service.readReportEvidence(tx as unknown as Prisma.TransactionClient, actor, groups(), 'trace'),
    download: () => service.download(actor, file.id, 'trace'),
  };
  return { actor, resource, user, file, hidden, records, tx, grant, adapter, resources, service, storage, audit, readers, queries };
}

const denied = { response: { code: 'FILE_RESOURCE_DENIED' } };
const conflict = { response: { code: 'CONCURRENCY_CONFLICT' } };
const readerNames = ['get', 'evidence', 'report', 'download'] as const;

describe('file-ID read allowlist (unit boundary doubles, not integration evidence)', () => {
  it.each(readerNames)('%s preserves unrestricted grants and admits explicitly disclosed IDs', async name => {
    const s = setup(); await expect(s.readers[name]()).resolves.toBeDefined();
    s.grant.readableFileIds = [s.file.id]; await expect(s.readers[name]()).resolves.toBeDefined();
  });

  it.each(readerNames)('%s denies empty and nonmatching allowlists', async name => {
    const s = setup(); s.grant.readableFileIds = [];
    await expect(s.readers[name]()).rejects.toMatchObject(denied);
    s.grant.readableFileIds = [s.hidden.id]; await expect(s.readers[name]()).rejects.toMatchObject(denied);
    expect(s.storage.createDownloadUrl).not.toHaveBeenCalled(); expect(s.audit.record).not.toHaveBeenCalled();
  });

  it('filters the list before the quota limit and returns no metadata for an empty allowlist', async () => {
    const s = setup(); s.grant.readableFileIds = [s.file.id];
    expect(await s.service.listResource(s.actor, s.resource)).toEqual([expect.objectContaining({ id: s.file.id })]);
    s.grant.readableFileIds = []; expect(await s.service.listResource(s.actor, s.resource)).toEqual([]);
  });

  it.each(readerNames)('%s rejects same-user same-version revocation at final authorization', async name => {
    const s = setup(); s.grant.readableFileIds = [s.file.id];
    s.adapter.authorizeAndLock.mockImplementation(async () => {
      if (s.adapter.authorizeAndLock.mock.calls.length === 2) s.grant.readableFileIds = [];
      return s.grant;
    });
    await expect(s.readers[name]()).rejects.toMatchObject({ status: expect.any(Number) });
    expect(s.storage.createDownloadUrl).not.toHaveBeenCalled(); expect(s.audit.record).not.toHaveBeenCalled();
  });

  it('rejects list revocation after querying metadata, including mutation of a shared grant array', async () => {
    const s = setup(); const ids = [s.file.id]; s.grant.readableFileIds = ids;
    s.tx.fileObject.findMany.mockImplementation(async ({ take }) => {
      if (take) ids.splice(0);
      return take ? [structuredClone(s.file)] : [];
    });
    await expect(s.service.listResource(s.actor, s.resource)).rejects.toMatchObject(conflict);
  });

  it.each(readerNames)('%s rejects any changed read scope, not just a removed requested ID', async name => {
    const s = setup(); s.grant.readableFileIds = [s.file.id];
    s.adapter.authorizeAndLock.mockImplementation(async () => {
      if (s.adapter.authorizeAndLock.mock.calls.length === 2) s.grant.readableFileIds = undefined;
      return s.grant;
    });
    await expect(s.readers[name]()).rejects.toMatchObject(conflict);
  });

  it('does not return a URL when disclosure is withdrawn while signing outside the transaction', async () => {
    const s = setup(); s.grant.readableFileIds = [s.file.id];
    s.storage.createDownloadUrl.mockImplementation(async () => { s.grant.readableFileIds = []; return 'https://storage.invalid/withdrawn'; });
    await expect(s.readers.download()).rejects.toMatchObject(denied);
    expect(s.audit.record).not.toHaveBeenCalled();
  });

  it('does not return a URL for a file moved to a different resource while signing', async () => {
    const s = setup(); s.grant.readableFileIds = [s.file.id];
    s.storage.createDownloadUrl.mockImplementation(async () => { s.file.resourceId = randomUUID(); return 'https://storage.invalid/moved'; });
    await expect(s.readers.download()).rejects.toMatchObject(conflict);
    expect(s.audit.record).not.toHaveBeenCalled();
  });

  it.each(['version', 'objectVersionId', 'objectKey', 'sha256'] as const)('rechecks signed file %s before returning the URL', async key => {
    const s = setup(); s.grant.readableFileIds = [s.file.id];
    s.storage.createDownloadUrl.mockImplementation(async () => {
      Object.assign(s.file, { [key]: key === 'version' ? 4 : randomUUID() });
      if (key === 'sha256') s.file.verifiedSha256 = s.file.sha256;
      return 'https://storage.invalid/changed';
    });
    await expect(s.readers.download()).rejects.toMatchObject(conflict);
    expect(s.audit.record).not.toHaveBeenCalled();
  });

  it('rechecks the session after signing, before auditing a successful download', async () => {
    const s = setup(); s.grant.readableFileIds = [s.file.id];
    s.storage.createDownloadUrl.mockImplementation(async () => { s.tx.session.findFirst.mockResolvedValue(null as never); return 'https://storage.invalid/revoked'; });
    await expect(s.readers.download()).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
    expect(s.audit.record).not.toHaveBeenCalled();
  });

  it.each([null, 'all', {}, [42], [''], ['not-a-uuid'], [randomUUID(), 'bad'], Array(1)])('rejects malformed adapter IDs: %p', async value => {
    const s = setup(); Object.assign(s.grant, { readableFileIds: value });
    await expect(s.resources.authorizeAndLock(s.tx as unknown as Prisma.TransactionClient, s.actor, s.resource, 'read')).rejects.toMatchObject(denied);
  });

  it('rejects duplicate IDs and malformed grant organization IDs', async () => {
    const s = setup(); s.grant.readableFileIds = [s.file.id, s.file.id];
    await expect(s.readers.get()).rejects.toMatchObject(denied);
    s.grant.readableFileIds = []; s.grant.organizationId = 'not-a-uuid';
    await expect(s.readers.get()).rejects.toMatchObject(denied);
  });

  it('snapshots adapter arrays so later mutation cannot rewrite initial authorization', async () => {
    const s = setup(); const ids = [s.file.id]; s.grant.readableFileIds = ids;
    const result = await s.resources.authorizeAndLock(s.tx as unknown as Prisma.TransactionClient, s.actor, s.resource, 'read');
    ids.splice(0); expect((result as typeof s.grant).readableFileIds).toEqual([s.file.id]);
  });

  it('snapshots and validates the grant before awaiting organization lookup', async () => {
    const s = setup(); const ids = [s.file.id]; s.grant.readableFileIds = ids;
    s.tx.organization.findUnique.mockImplementation(async () => { ids.splice(0); s.grant.version = 3; return s.user.organization; });
    const result = await s.resources.authorizeAndLock(s.tx as unknown as Prisma.TransactionClient, s.actor, s.resource, 'read');
    expect(result).toMatchObject({ version: 2, readableFileIds: [s.file.id] });
  });

  it('keeps supplier organization isolation even when the grant explicitly lists the file', async () => {
    const s = setup(); s.actor.accountType = 'SUPPLIER'; s.user.accountType = 'SUPPLIER';
    s.grant.organizationId = randomUUID(); s.grant.readableFileIds = [s.file.id];
    for (const read of Object.values(s.readers)) await expect(read()).rejects.toMatchObject(denied);
  });

  it('allows an unchanged set in a different order and does not expose storage keys in metadata', async () => {
    const s = setup(); const ids = [s.file.id, s.hidden.id]; s.grant.readableFileIds = ids;
    s.adapter.authorizeAndLock.mockImplementation(async () => ({ ...s.grant, readableFileIds: s.adapter.authorizeAndLock.mock.calls.length % 2 ? ids : [...ids].reverse() }));
    for (const read of [s.readers.get, s.readers.evidence]) expect(JSON.stringify(await read())).not.toMatch(/objectKey|objectVersionId|downloadUrl/);
  });

  it.each(['organizationId', 'resourceType', 'resourceId'] as const)('does not bypass evidence %s ownership', async key => {
    const s = setup(); s.grant.readableFileIds = [s.file.id]; s.file[key] = randomUUID();
    for (const read of [s.readers.evidence, s.readers.report]) await expect(read()).rejects.toMatchObject(denied);
  });

  it.each(['organizationId', 'resourceType', 'resourceId'] as const)('rechecks single-file %s ownership after locking', async key => {
    const s = setup(); s.grant.readableFileIds = [s.file.id];
    s.tx.fileObject.findUnique.mockImplementationOnce(async () => {
      const candidate = structuredClone(s.file); s.file[key] = randomUUID(); return candidate;
    });
    await expect(s.readers.get()).rejects.toMatchObject(denied);
  });

  it.each(['QUARANTINED', 'DELETED'] as const)('does not bypass %s availability on download or report', async status => {
    const s = setup(); s.grant.readableFileIds = [s.file.id]; s.file.status = status;
    await expect(s.readers.download()).rejects.toMatchObject({ response: { code: 'FILE_NOT_AVAILABLE' } });
    await expect(s.readers.report()).rejects.toMatchObject({ response: { code: 'FILE_NOT_AVAILABLE' } });
  });

  it.each(['PENDING', 'REJECTED'] as const)('does not bypass %s scan results', async scanStatus => {
    const s = setup(); s.grant.readableFileIds = [s.file.id]; s.file.scanStatus = scanStatus;
    await expect(s.readers.download()).rejects.toMatchObject({ response: { code: 'FILE_NOT_AVAILABLE' } });
    await expect(s.readers.report()).rejects.toMatchObject({ response: { code: 'FILE_NOT_AVAILABLE' } });
  });

  it.each(['upload', 'complete', 'delete', 'attach'] as const)('does not grant %s when the adapter denies writing', async action => {
    const s = setup(); s.grant.readableFileIds = [s.file.id];
    s.adapter.authorizeAndLock.mockImplementation(async (_tx, _actor, _resource, requested) => {
      if (requested !== 'read') throw new Error('WRITE_DENIED');
      return s.grant;
    });
    const write = action === 'upload' ? () => s.service.initializeUpload(s.actor, { ...s.resource, originalName: 'x.txt', contentType: 'text/plain', sizeBytes: 12, sha256: s.file.sha256 }, randomUUID(), 'trace')
      : action === 'complete' ? () => s.service.complete(s.actor, s.file.id, 3, randomUUID(), 'trace')
        : action === 'delete' ? () => s.service.deleteLogically(s.actor, s.file.id, 3, 'trace')
          : () => s.service.assertAttachable(s.tx as unknown as Prisma.TransactionClient, s.actor, s.resource, [s.file.id]);
    await expect(write()).rejects.toThrow('WRITE_DENIED');
  });

  it('does not narrow adapter-authorized attachment writes with an empty read allowlist', async () => {
    const s = setup(); s.grant.readableFileIds = [];
    await expect(s.service.assertAttachable(s.tx as unknown as Prisma.TransactionClient, s.actor, s.resource, [s.file.id])).resolves.toHaveLength(1);
  });

  it.each(readerNames)('%s retains authentication and version checks', async name => {
    const s = setup(); s.grant.readableFileIds = [s.file.id];
    s.tx.session.findFirst.mockResolvedValue(null as never);
    await expect(s.readers[name]()).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
    s.tx.session.findFirst.mockResolvedValue({ securityVersion: 1, mfaVerifiedAt: null });
    s.adapter.authorizeAndLock.mockClear().mockImplementation(async () => ({ ...s.grant, version: s.adapter.authorizeAndLock.mock.calls.length === 1 ? 2 : 3 }));
    await expect(s.readers[name]()).rejects.toMatchObject(conflict);
  });
});
