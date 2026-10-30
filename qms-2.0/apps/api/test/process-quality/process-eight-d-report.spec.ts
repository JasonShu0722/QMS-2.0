import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { ProcessEightDReportService } from '../../src/modules/process-quality/process-eight-d-report.service.js';
import type { InternalEightDReportDescriptor } from '../../src/common/eight-d/internal-eight-d-report.js';
import { INTERNAL_EIGHT_D_DOMAINS } from '../../src/common/eight-d/internal-eight-d-domain.js';
import type { ProcessEightDActor } from '../../src/modules/process-quality/process-eight-d.types.js';

const id = randomUUID(); const organizationId = randomUUID(); const revisionId = randomUUID(); const fileId = randomUUID();
const actor: ProcessEightDActor = { id: randomUUID(), organizationId, accountType: 'INTERNAL', sessionId: randomUUID() };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
const hash = createHash('sha256').update(png).digest('hex');

function setup(withFile = false, domain?: InternalEightDReportDescriptor, operationReceipts?: unknown) {
  const document = emptyProcessEightDDocument();
  if (withFile) document.okFileIds = [fileId];
  const snapshot = { document, sources: [], problem: { id, organizationId, domainCode: domain?.domainCode ?? 'process-quality', reportNumber: '8D-TEST', closedAt: null }, instance: { version: 2 },
    contentVersion: 2, rowVersion: 3, ownerUserId: randomUUID(), professionalUserId: randomUUID(), responsibleSectionDepartmentId: randomUUID(),
    collaboratorUserIds: [], deadlines: { analysisDueAt: null, submissionDueAt: null, closureDueAt: null }, analysisCompletedAt: null, submittedAt: null };
  const result = { record: { report: { closedRevisionId: null }, problem: { id, organizationId, domainCode: snapshot.problem.domainCode }, node: { config: {} } }, revision: null, snapshot };
  const calls: string[] = []; const permissions: unknown[] = []; let inside = false; let rollbacks = 0;
  const tx = {
    user: { findUnique: async () => ({ ...actor, status: 'ACTIVE', organization: { status: 'ACTIVE' } }) },
    organization: { findUnique: async () => ({ status: 'ACTIVE' }) },
    $queryRaw: async (sql?: unknown) => { permissions.push(sql); return [{ allowed: true }]; },
  };
  const prisma = { $transaction: async (work: (value: typeof tx) => Promise<unknown>) => {
    if (inside) throw new Error('nested transaction');
    inside = true;
    try { return await work(tx); } catch (error) { rollbacks++; throw error; } finally { inside = false; }
  } };
  const core = { readReport: jest.fn(async (_tx: unknown, _actor: unknown, _id: string, _revision: string | null | undefined) => { calls.push('report'); return structuredClone(result); }) };
  const ref = { id: fileId, resourceType: domain?.resourceType ?? 'process-eight-d', resourceId: id, originalName: '检验图.png', contentType: 'image/png', sizeBytes: png.length,
    sha256: hash, status: 'AVAILABLE', scanStatus: 'CLEAN', scannedAt: '2026-10-25T08:00:00Z', downloadable: true,
    objectKey: randomUUID(), objectVersionId: 'object-v1', version: 2 };
  const files = { readReportEvidence: jest.fn(async () => { calls.push('files'); return withFile ? [structuredClone(ref)] : []; }) };
  const storage = { readVersion: jest.fn(async function* () { expect(inside).toBe(false); calls.push('storage'); yield png; }) };
  const audit = { record: jest.fn(async (_input: unknown, transaction?: unknown) => {
    if (!transaction) { expect(inside).toBe(false); expect(rollbacks).toBeGreaterThan(0); }
    calls.push('audit');
  }) };
  // These are unit boundary doubles, not PostgreSQL/object-store acceptance evidence.
  const service = Reflect.construct(ProcessEightDReportService, [prisma, core, files, storage, audit, domain, operationReceipts]) as ProcessEightDReportService;
  return { service, result, core, files, ref, storage, calls, tx, audit, permissions };
}

it('records the actual PDF thread render as bounded metadata without reporting a persistent PDF queue', async () => {
  const receipts = { recordPdf: jest.fn<(...args: unknown[]) => Promise<boolean>>(async () => true) };
  const s = setup(false, undefined, receipts);
  const result = await s.service.pdf(actor, id, {}, 'receipt-trace');
  expect(result.content.subarray(0, 4).toString()).toBe('%PDF');
  expect(receipts.recordPdf).toHaveBeenNthCalledWith(1, organizationId, 'process-quality', expect.any(String), 'STARTED', expect.any(Date));
  expect(receipts.recordPdf).toHaveBeenNthCalledWith(2, organizationId, 'process-quality', expect.any(String), 'SUCCEEDED', expect.any(Date));
  expect(receipts.recordPdf.mock.calls.every(call => call.length === 5)).toBe(true);
});

it('defaults to explicit current snapshot and rechecks scope before returning JSON', async () => {
  const s = setup();
  const report = await s.service.read(actor, id, {}, 'trace');
  expect(report.status).toBe('DRAFT'); expect(report.view).toBe('CURRENT');
  expect(s.core.readReport.mock.calls.map(call => call[3])).toEqual([null, null]);
  expect(s.calls.at(-1)).toBe('audit');
  expect(s.audit.record).toHaveBeenCalledTimes(1);
});

it('rejects unsupported or mixed server descriptors rather than falling back to process resources', () => {
  for (const domain of [
    { ...INTERNAL_EIGHT_D_DOMAINS.CUSTOMER, resourceType: 'process-eight-d' },
    { ...INTERNAL_EIGHT_D_DOMAINS.NEW_PRODUCT, permissionPrefix: 'process-quality:issues' },
    { domainCode: 'unknown', resourceType: 'unknown', permissionPrefix: 'unknown' },
  ]) expect(() => setup(false, domain)).toThrow('INTERNAL_EIGHT_D_REPORT_DOMAIN_INVALID');
});

it.each(['read', 'pdf'] as const)('%s preserves the real actor home and uses the authorized target for report permission and final audit', async format => {
  const s = setup(), target = randomUUID(), scoped = { ...actor, scopeOrganizationId: target };
  s.result.record.problem.organizationId = target;
  s.result.snapshot.problem.organizationId = target;
  const output = await s.service[format](scoped, id, { organizationId: target }, 'cross-trace');
  expect(output).toBeDefined();
  expect(s.core.readReport.mock.calls).toHaveLength(2);
  expect(s.core.readReport.mock.calls.every(call => call[1] === scoped)).toBe(true);
  expect(scoped.organizationId).toBe(actor.organizationId);
  expect(s.audit.record.mock.calls[0]![0]).toMatchObject({ organizationId: target, actorUserId: actor.id });
});

it.each(['read', 'pdf'] as const)('%s rejects historical 101-file evidence with a safe structured 409 before file access', async format => {
  const s = setup();
  const ids = Array.from({ length: 101 }, () => randomUUID());
  s.result.snapshot.document.okFileIds = ids.slice(0, 100);
  s.result.snapshot.document.ngFileIds = [ids[100]!];
  s.result.snapshot.document.description = 'private report contents';
  Object.assign(s.result, { revision: { id: revisionId } });
  Object.assign(s.result.record.report, { closedRevisionId: revisionId });
  await expect(s.service[format](actor, id, { revisionId }, 'trace')).rejects.toMatchObject({ status: 409,
    response: { code: 'PROCESS_EIGHT_D_REPORT_EVIDENCE_LIMIT', message: 'PROCESS_EIGHT_D_REPORT_EVIDENCE_LIMIT' } });
  expect(s.files.readReportEvidence).not.toHaveBeenCalled();
  expect(s.storage.readVersion).not.toHaveBeenCalled();
  expect(s.audit.record).not.toHaveBeenCalled();
});

it('reads 100 distinct authorized attachments while counting cross-section reuse only once', async () => {
  const s = setup(true);
  const ids = [fileId, ...Array.from({ length: 99 }, () => randomUUID())];
  s.result.snapshot.document.okFileIds = ids.slice(0, 99);
  s.result.snapshot.document.ngFileIds = [ids[99]!];
  s.result.snapshot.document.analysisFileIds = [fileId];
  s.result.snapshot.document.temporaryMeasures = [{ id: 't', description: '', departmentOwner: '', introducedAt: null, fileIds: [fileId] }];
  s.files.readReportEvidence.mockImplementation(async () => ids.map(id => ({ ...s.ref, id })));
  const report = await s.service.read(actor, id, {}, 'trace');
  expect(report.attachments).toHaveLength(100);
  expect(report.attachments[0]!.uses).toEqual(['D2 OK', 'D4 分析', 'D3 临时措施 t']);
  expect(s.files.readReportEvidence).toHaveBeenCalledTimes(2);
  expect(s.files.readReportEvidence).toHaveBeenNthCalledWith(1, s.tx, actor,
    [{ resource: { resourceType: 'process-eight-d', resourceId: id }, fileIds: ids }], undefined);
});

it('converts malformed historical documents into a safe snapshot error rather than leaking domain validation', async () => {
  const s = setup();
  Object.assign(s.result.snapshot.document, { privateUnknownField: 'private historical contents' });
  await expect(s.service.read(actor, id, {}, 'trace')).rejects.toMatchObject({ status: 409,
    response: { code: 'PROCESS_EIGHT_D_REPORT_SNAPSHOT_INVALID', message: 'PROCESS_EIGHT_D_REPORT_SNAPSHOT_INVALID' } });
  expect(s.files.readReportEvidence).not.toHaveBeenCalled();
});

it('does not turn an unavailable approved view into a current draft', async () => {
  const s = setup();
  await expect(s.service.read(actor, id, { view: 'APPROVED' }, 'trace')).rejects.toMatchObject({ status: 409 });
});

it('selects immutable revisions without projecting current content or versions over history', async () => {
  const s = setup();
  Object.assign(s.result, { revision: { id: revisionId, contentVersion: 2 } });
  Object.assign(s.result.record.report, { closedRevisionId: revisionId, version: 1000 });
  s.result.snapshot.document.description = '原批准正文';
  const report = await s.service.read(actor, id, { revisionId }, 'trace');
  expect(report.contentVersion).toBe(2); expect(report.rowVersion).toBe(3); expect(report.snapshot.document.description).toBe('原批准正文');
  expect(s.core.readReport.mock.calls.every(call => call[3] === revisionId)).toBe(true);
});

it('rejects invalid revision/current combinations and cross-organization direct service calls', async () => {
  const s = setup();
  await expect(s.service.read(actor, id, { revisionId, view: 'CURRENT' }, 'trace')).rejects.toMatchObject({ status: 400 });
  await expect(s.service.read(actor, id, { organizationId: randomUUID() }, 'trace')).rejects.toMatchObject({ status: 403 });
  await expect(s.service.read(actor, id, { revisionId: 'not-a-uuid' }, 'trace')).rejects.toMatchObject({ status: 400 });
  expect(s.core.readReport).not.toHaveBeenCalled();
});

it('requires domain report permission in the service, not only controller metadata', async () => {
  const s = setup(); s.tx.$queryRaw = async () => [{ allowed: false }];
  await expect(s.service.read(actor, id, {}, 'trace')).rejects.toMatchObject({ status: 403 });
  expect(s.audit.record).not.toHaveBeenCalled();
});

it('reads authenticated CLEAN pinned bytes outside transactions and strips internal object keys from JSON', async () => {
  const s = setup(true);
  const output = await s.service.pdf(actor, id, {}, 'trace');
  expect(output.content.subarray(0, 5).toString()).toBe('%PDF-');
  expect(s.calls).toEqual(['report', 'files', 'storage', 'report', 'files', 'audit']);
  const report = await s.service.read(actor, id, {}, 'trace');
  expect(report.attachments[0]?.objectVersionId).toBe('object-v1');
  expect(JSON.stringify(report)).not.toContain(s.ref.objectKey);
});

it('refuses unavailable/unscanned or historical-unpinned evidence before fetching bytes', async () => {
  const s = setup(true); s.ref.scanStatus = 'PENDING';
  await expect(s.service.pdf(actor, id, {}, 'trace')).rejects.toMatchObject({ status: 409 });
  expect(s.storage.readVersion).not.toHaveBeenCalled();
  s.ref.scanStatus = 'CLEAN'; Object.assign(s.result, { revision: { id: revisionId } });
  await expect(s.service.pdf(actor, id, { revisionId }, 'trace')).rejects.toMatchObject({ status: 409 });
  expect(s.storage.readVersion).not.toHaveBeenCalled();
});

it('refuses a fixed historical object version that no longer matches the authorized reference', async () => {
  const s = setup(true); Object.assign(s.result, { revision: { id: revisionId } });
  Object.assign(s.result.snapshot, { evidence: [{ id: fileId, version: 2, objectVersionId: 'old-object-v', sha256: hash, scanStatus: 'CLEAN', scannedAt: s.ref.scannedAt }] });
  await expect(s.service.pdf(actor, id, { revisionId }, 'trace')).rejects.toMatchObject({ status: 409 });
});

it('rejects byte hash mismatch without a successful export audit', async () => {
  const s = setup(true); s.ref.sha256 = '0'.repeat(64);
  await expect(s.service.pdf(actor, id, {}, 'trace')).rejects.toMatchObject({ status: 409 });
  expect(s.audit.record).not.toHaveBeenCalled();
});

it('rejects source/approval drift and file-version drift on final authorization instead of mixing snapshots', async () => {
  const s = setup(true);
  s.core.readReport.mockImplementation(async () => {
    const value = structuredClone(s.result);
    if (s.core.readReport.mock.calls.length === 2) value.snapshot.document.description = 'changed';
    return value;
  });
  await expect(s.service.pdf(actor, id, {}, 'trace')).rejects.toMatchObject({ status: 409 });
  expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'DENIED', traceId: 'trace' }));
  const f = setup(true);
  f.files.readReportEvidence.mockImplementation(async () => [{ ...f.ref, version: f.files.readReportEvidence.mock.calls.length === 1 ? 2 : 3 }]);
  await expect(f.service.pdf(actor, id, {}, 'trace')).rejects.toMatchObject({ status: 409 });
});

it.each(['read', 'pdf'] as const)('%s audits final 401/403/409 rejections outside the rolled-back transaction using fixed safe reasons', async format => {
  for (const status of [401, 403, 409]) {
    const s = setup();
    const rejection = new HttpException({ code: 'UNTRUSTED_PRIVATE_DETAIL', message: 'private document data' }, status);
    s.core.readReport.mockImplementation(async () => {
      if (s.core.readReport.mock.calls.length === 2) throw rejection;
      return structuredClone(s.result);
    });
    await expect(s.service[format](actor, id, {}, 'same-trace')).rejects.toBe(rejection);
    expect(s.audit.record).toHaveBeenCalledTimes(1);
    expect(s.audit.record).toHaveBeenCalledWith({ organizationId, actorUserId: actor.id, action: 'PROCESS_EIGHT_D_REPORT_REJECTED',
      resourceType: 'ProcessEightDReport', resourceId: id, outcome: 'DENIED', traceId: 'same-trace',
      metadata: { permissionCode: 'process-quality:issues:report', reasonCode: status === 409
        ? 'PROCESS_EIGHT_D_REPORT_VERSION_CONFLICT' : 'PROCESS_EIGHT_D_REPORT_ACCESS_DENIED' } });
  }
});

it.each(['read', 'pdf'] as const)('%s audits final report-permission revocation without converting 403 to 409', async format => {
  const s = setup(); let checks = 0;
  s.tx.$queryRaw = async () => [{ allowed: ++checks === 1 }];
  await expect(s.service[format](actor, id, {}, 'revoked-trace')).rejects.toMatchObject({ status: 403 });
  expect(s.core.readReport).toHaveBeenCalledTimes(2);
  expect(s.audit.record).toHaveBeenCalledTimes(1);
  expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'PROCESS_EIGHT_D_REPORT_REJECTED',
    outcome: 'DENIED', traceId: 'revoked-trace', metadata: { permissionCode: 'process-quality:issues:report', reasonCode: 'PROCESS_EIGHT_D_REPORT_ACCESS_DENIED' } }));
});

it('budgets repeated image references before rendering rather than only unique attachments', async () => {
  const s = setup(true); const header = Buffer.from(png.subarray(0, 33));
  header.writeUInt32BE(4000, 16); header.writeUInt32BE(4000, 20);
  s.result.snapshot.document.temporaryMeasures = Array.from({ length: 3 }, (_, index) => ({
    id: `measure-${index}`, description: '', departmentOwner: '', introducedAt: null, fileIds: [fileId],
  }));
  s.ref.sizeBytes = header.length; s.ref.sha256 = createHash('sha256').update(header).digest('hex');
  s.storage.readVersion.mockImplementation(async function* () { yield header; });
  await expect(s.service.pdf(actor, id, {}, 'trace')).rejects.toMatchObject({ status: 413 });
  expect(s.core.readReport).toHaveBeenCalledTimes(1);
  expect(s.audit.record).not.toHaveBeenCalled();
});

it('propagates final authorization revocation and storage errors rather than swallowing them into a PDF', async () => {
  const s = setup(true);
  s.core.readReport.mockImplementation(async () => {
    if (s.core.readReport.mock.calls.length === 2) throw Object.assign(new Error('AUTH_SESSION_REQUIRED'), { status: 401 });
    return structuredClone(s.result);
  });
  await expect(s.service.pdf(actor, id, {}, 'trace')).rejects.toMatchObject({ status: 401 });
  const f = setup(true);
  f.storage.readVersion.mockImplementation(async function* () { throw new Error('storage unavailable'); });
  await expect(f.service.pdf(actor, id, {}, 'trace')).rejects.toMatchObject({ status: 503 });
});

it('reports storage object-version/integrity conflicts as 409 rather than generic unavailability', async () => {
  const s = setup(true);
  s.storage.readVersion.mockImplementation(async function* () { throw new Error('FILE_OBJECT_INVALID'); });
  await expect(s.service.pdf(actor, id, {}, 'trace')).rejects.toMatchObject({ status: 409 });
  expect(s.audit.record).not.toHaveBeenCalled();
});

describe.each([
  { domainCode: 'customer-quality', resourceType: 'customer-eight-d', permissionPrefix: 'customer-quality:issues', prefix: 'CUSTOMER_EIGHT_D', auditResource: 'CustomerEightDReport' },
  { domainCode: 'new-product-quality', resourceType: 'new-product-eight-d', permissionPrefix: 'new-product-quality:issues', prefix: 'NEW_PRODUCT_EIGHT_D', auditResource: 'NewProductEightDReport' },
])('$domainCode server-owned report pipeline', domain => {
  it('uses the domain core, permission, pinned file resource and audit scope without process fallback', async () => {
    const s = setup(true, domain);
    const output = await s.service.pdf(actor, id, {}, 'domain-trace');
    expect(output.content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(output.filename).toBe(`${domain.resourceType}-${id}-v2-current.pdf`);
    expect(s.calls).toEqual(['report', 'files', 'storage', 'report', 'files', 'audit']);
    expect(s.files.readReportEvidence).toHaveBeenNthCalledWith(1, s.tx, actor,
      [{ resource: { resourceType: domain.resourceType, resourceId: id }, fileIds: [fileId] }], undefined);
    expect(s.files.readReportEvidence).toHaveBeenNthCalledWith(2, s.tx, actor,
      [{ resource: { resourceType: domain.resourceType, resourceId: id }, fileIds: [fileId] }], 'domain-trace');
    expect(s.permissions).toHaveLength(2);
    for (const query of s.permissions as { strings: string[]; values: unknown[] }[]) {
      const parameter = query.strings.findIndex(part => part.endsWith('AND permission.code = '));
      expect(parameter).toBeGreaterThanOrEqual(0);
      expect(query.values[parameter]).toBe(`${domain.permissionPrefix}:report`);
    }
    expect(s.storage.readVersion).toHaveBeenCalledWith(s.ref.objectKey, 'object-v1', 8 * 1024 * 1024);
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ organizationId, action: `${domain.prefix}_REPORT_PDF`,
      resourceType: domain.auditResource, resourceId: id, outcome: 'SUCCESS', traceId: 'domain-trace' }), s.tx);
  });

  it('rejects process evidence even when its ID and problem ID match', async () => {
    const s = setup(true, domain); s.ref.resourceType = 'process-eight-d';
    await expect(s.service.pdf(actor, id, {}, 'trace')).rejects.toMatchObject({ status: 403 });
    expect(s.storage.readVersion).not.toHaveBeenCalled();
  });

  it('retains final read revocation and domain-scoped safe rejection auditing', async () => {
    const s = setup(true, domain); let checks = 0;
    s.tx.$queryRaw = async () => [{ allowed: ++checks === 1 }];
    await expect(s.service.pdf(actor, id, {}, 'revoke')).rejects.toMatchObject({ status: 403 });
    expect(s.audit.record).toHaveBeenCalledWith({ organizationId, actorUserId: actor.id, action: `${domain.prefix}_REPORT_REJECTED`,
      resourceType: domain.auditResource, resourceId: id, outcome: 'DENIED', traceId: 'revoke',
      metadata: { permissionCode: `${domain.permissionPrefix}:report`, reasonCode: `${domain.prefix}_REPORT_ACCESS_DENIED` } });
  });

  it('retains fingerprint conflict detection and domain error codes', async () => {
    const s = setup(true, domain);
    s.core.readReport.mockImplementation(async () => {
      const value = structuredClone(s.result);
      if (s.core.readReport.mock.calls.length === 2) value.snapshot.document.description = 'changed';
      return value;
    });
    await expect(s.service.pdf(actor, id, {}, 'drift')).rejects.toMatchObject({ status: 409,
      response: { code: `${domain.prefix}_REPORT_VERSION_CONFLICT` } });
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'DENIED', resourceType: domain.auditResource }));
  });

  it('keeps APPROVED, HISTORICAL and closed CURRENT supplements distinct', async () => {
    const s = setup(false, domain);
    Object.assign(s.result.record.report, { closedRevisionId: revisionId });
    expect(await s.service.read(actor, id, { view: 'CURRENT' }, 'current')).toMatchObject({ view: 'CURRENT', status: 'CLOSED_SUPPLEMENT' });
    Object.assign(s.result, { revision: { id: revisionId } });
    expect(await s.service.read(actor, id, { view: 'APPROVED' }, 'approved')).toMatchObject({ view: 'APPROVED', status: 'APPROVED' });
    expect(await s.service.read(actor, id, { revisionId }, 'history')).toMatchObject({ view: 'HISTORICAL', status: 'HISTORICAL' });
    expect(s.core.readReport.mock.calls.map(call => call[3])).toEqual([null, null, undefined, undefined, revisionId, revisionId]);
  });

  it('does not allow request fields to select a different domain', async () => {
    const s = setup(false, domain);
    await expect(s.service.read(actor, id, { domainCode: 'process-quality' } as never, 'trace')).rejects.toMatchObject({ status: 400,
      response: { code: `${domain.prefix}_REPORT_QUERY_INVALID` } });
    expect(s.core.readReport).not.toHaveBeenCalled();
  });
});
