import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { SupplierEightDReportService } from '../../src/modules/supplier-quality/supplier-eight-d-report.service.js';
import type { SupplierEightDActor } from '../../src/modules/supplier-quality/supplier-eight-d.types.js';
import { id, organizationId, vendor, revisionId, reportRead } from './supplier-eight-d-report.fixture.js';

const actor: SupplierEightDActor = { id: randomUUID(), organizationId, accountType: 'INTERNAL', sessionId: randomUUID() };
const supplier: SupplierEightDActor = { ...actor, id: randomUUID(), organizationId: vendor, accountType: 'SUPPLIER' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
const fileId = randomUUID();

function setup(withFile = false) {
  const result = reportRead(), calls: string[] = [];
  if (withFile) (result.snapshot as any).document.okFileIds = [fileId];
  const ref = { id: fileId, organizationId: vendor, resourceType: 'supplier-quality', resourceId: id, originalName: 'OK检验.png', contentType: 'image/png', sizeBytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex'), status: 'AVAILABLE', scanStatus: 'CLEAN', scannedAt: '2026-10-28T00:00:00.000Z', downloadable: true,
    objectKey: randomUUID(), objectVersionId: 'version-1', version: 2 };
  let inside = false, rollbacks = 0;
  const tx = { user: { findUnique: async () => ({ ...actor, status: 'ACTIVE', organization: { status: 'ACTIVE' } }) },
    organization: { findUnique: async () => ({ status: 'ACTIVE' }) }, $queryRaw: jest.fn(async (_query: unknown) => [{ allowed: true }]) };
  const prisma = { $transaction: async (work: (value: typeof tx) => Promise<unknown>) => {
    expect(inside).toBe(false); inside = true;
    try { return await work(tx); } catch (error) { rollbacks++; throw error; } finally { inside = false; }
  } };
  const core = { readReport: jest.fn(async (_tx: unknown, _actor: unknown, _id: string, _revision: string | null | undefined) => { calls.push('core'); return structuredClone(result); }) };
  const files = { readReportEvidence: jest.fn(async () => { expect(inside).toBe(true); calls.push('files'); return withFile ? [structuredClone(ref)] : []; }) };
  const storage = { readVersion: jest.fn(async function* () { expect(inside).toBe(false); calls.push('storage'); yield png; }) };
  const audit = { record: jest.fn(async (_record: unknown, transaction?: unknown) => {
    expect(inside).toBe(!!transaction); if (!transaction) expect(rollbacks).toBeGreaterThan(0); calls.push('audit');
  }) };
  // Boundary doubles exercise orchestration only, never count as PG/storage/scanner acceptance.
  return { service: new SupplierEightDReportService(prisma as never, core, files as never, storage as never, audit as never), result, ref, calls, core, files, storage, audit, tx };
}

it('selects twice with the original actor, scopes real report permission and audits only after the final check', async () => {
  const s = setup(true);
  const report = await s.service.read(actor, id, {}, 'read-trace');
  expect(report).toMatchObject({ supplierProblemId: id, status: 'DRAFT', view: 'CURRENT' });
  expect(s.core.readReport.mock.calls.map(call => call.slice(1))).toEqual([[actor, id, null], [actor, id, null]]);
  expect(s.calls).toEqual(['core', 'files', 'core', 'files', 'audit']);
  expect(JSON.stringify(report)).not.toContain(s.ref.objectKey);
  expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ organizationId, resourceType: 'SupplierEightDReport', resourceId: id, action: 'SUPPLIER_EIGHT_D_REPORT_READ' }), s.tx);
});

it('renders fixed verified image bytes outside transactions and final-audits the actual PDF hash', async () => {
  const s = setup(true);
  const output = await s.service.pdf(actor, id, {}, 'pdf-trace');
  expect(output.content.subarray(0, 5).toString()).toBe('%PDF-');
  expect(output.filename).toBe(`supplier-eight-d-${id}-v2-current.pdf`);
  expect(s.calls).toEqual(['core', 'files', 'storage', 'core', 'files', 'audit']);
  expect(s.storage.readVersion).toHaveBeenCalledWith(s.ref.objectKey, s.ref.objectVersionId, 8 * 1024 * 1024);
  expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ sha256: createHash('sha256').update(output.content).digest('hex'), sizeBytes: output.content.length }) }), s.tx);
});

it.each(['read', 'pdf'] as const)('%s rejects client snapshot/domain/key injection and bad or conflicting selections before core access', async method => {
  for (const query of [{ snapshot: {} }, { domainCode: 'process-quality' }, { revisionId, view: 'CURRENT' }, { view: null }, { revisionId: 'x' }, { organizationId: randomUUID() }]) {
    const s = setup();
    await expect(s.service[method](actor, id, query as never, 't')).rejects.toBeInstanceOf(HttpException);
    expect(s.core.readReport).not.toHaveBeenCalled();
  }
});

it('requires real report permission internally and only responses read for the released supplier enterprise', async () => {
  for (const person of [actor, supplier]) {
    const s = setup(); s.tx.user.findUnique = async () => ({ ...person, status: 'ACTIVE', organization: { status: 'ACTIVE' } });
    s.tx.$queryRaw.mockResolvedValue([{ allowed: false }]);
    await expect(s.service.read(person, id, {}, 't')).rejects.toMatchObject({ status: 403 });
    expect(s.core.readReport.mock.calls[0]![1]).toBe(person);
    expect(s.audit.record).not.toHaveBeenCalled();
    const query = s.tx.$queryRaw.mock.calls[0]![0] as { values: unknown[] };
    expect(query.values).toContain(person.accountType === 'INTERNAL' ? 'supplier-quality:issues:report' : 'supplier-quality:responses:read');
  }
});

it('returns supplier current and approved reports without internal permission grants', async () => {
  const s = setup(); s.tx.user.findUnique = async () => ({ ...supplier, status: 'ACTIVE', organization: { status: 'ACTIVE' } });
  const output = await s.service.read(supplier, id, {}, 'portal');
  expect(output.status).toBe('DRAFT');
  expect(s.core.readReport.mock.calls.every(call => call[1] === supplier)).toBe(true);
  const queries = s.tx.$queryRaw.mock.calls.map(call => call[0]) as { strings: string[]; values: unknown[] }[];
  expect(queries.every(query => query.values[query.strings.findIndex(part => part.endsWith('AND permission.code = '))] === 'supplier-quality:responses:read')).toBe(true);
});

it('fails closed on unissued, cross-enterprise and private closed-current supplier reads', async () => {
  for (const mutate of [
    (s: ReturnType<typeof setup>) => { s.result.record.supplier.releasedToSupplierAt = null; },
    (s: ReturnType<typeof setup>) => { s.result.record.supplier.supplierOrganizationId = randomUUID(); },
    (s: ReturnType<typeof setup>) => { s.result.record.control.closedAt = new Date(); s.result.record.control.approvedRevisionId = revisionId; },
  ]) {
    const s = setup(); mutate(s);
    s.tx.user.findUnique = async () => ({ ...supplier, status: 'ACTIVE', organization: { status: 'ACTIVE' } });
    await expect(s.service.read(supplier, id, {}, 't')).rejects.toBeInstanceOf(HttpException);
    expect(s.files.readReportEvidence).not.toHaveBeenCalled(); expect(s.storage.readVersion).not.toHaveBeenCalled();
  }
});

it('groups private supplement files separately and never uses that resource for portal evidence', async () => {
  const s = setup(true); s.result.record.control.closedAt = new Date(); s.result.privateSupplementFileIds = [fileId]; s.ref.resourceType = 'supplier-eight-d-supplement';
  const output = await s.service.read(actor, id, {}, 't');
  expect(output.status).toBe('CLOSED_SUPPLEMENT');
  expect(s.files.readReportEvidence).toHaveBeenCalledWith(s.tx, actor, [{ resource: { resourceType: 'supplier-eight-d-supplement', resourceId: id }, fileIds: [fileId] }], undefined);
  const portal = setup(true); portal.result.privateSupplementFileIds = [fileId];
  portal.tx.user.findUnique = async () => ({ ...supplier, status: 'ACTIVE', organization: { status: 'ACTIVE' } });
  await expect(portal.service.pdf(supplier, id, {}, 't')).rejects.toMatchObject({ status: 403 });
  expect(portal.storage.readVersion).not.toHaveBeenCalled();
});

it.each(['objectVersionId', 'sha256', 'version', 'scannedAt', 'scanStatus'] as const)('validates pinned history %s for every fixed attachment', async field => {
  const s = setup(true); s.result.revision = { id: revisionId };
  (s.result.snapshot as any).evidence = [{ ...s.ref, [field]: field === 'version' ? 999 : 'wrong' }];
  await expect(s.service.pdf(actor, id, { revisionId }, 't')).rejects.toMatchObject({ status: 409 });
  expect(s.storage.readVersion).not.toHaveBeenCalled();
});

it.each(['PENDING', 'INFECTED', 'ERROR'])('refuses %s scan evidence and unavailable object versions', async scanStatus => {
  const s = setup(true); s.ref.scanStatus = scanStatus;
  await expect(s.service.pdf(actor, id, {}, 't')).rejects.toMatchObject({ status: 409 }); expect(s.storage.readVersion).not.toHaveBeenCalled();
});

it('does not accept a different file resource, duplicate refs or unpinned historical evidence', async () => {
  const wrong = setup(true); wrong.ref.resourceType = 'process-eight-d';
  await expect(wrong.service.read(actor, id, {}, 't')).rejects.toMatchObject({ status: 403 });
  const duplicate = setup(true); duplicate.files.readReportEvidence.mockResolvedValue([duplicate.ref, duplicate.ref]);
  await expect(duplicate.service.read(actor, id, {}, 't')).rejects.toMatchObject({ status: 403 });
  const unpinned = setup(true); unpinned.result.revision = { id: revisionId };
  await expect(unpinned.service.pdf(actor, id, { revisionId }, 't')).rejects.toMatchObject({ status: 409 });
});

it('rejects truncation, SHA mismatch and unavailable fixed versions without a success audit', async () => {
  for (const mode of ['truncated', 'hash', 'missing', 'offline']) {
    const s = setup(true);
    if (mode === 'hash') s.ref.sha256 = '0'.repeat(64);
    if (mode === 'truncated') s.storage.readVersion.mockImplementation(async function* () { yield png.subarray(0, 20); });
    if (mode === 'missing' || mode === 'offline') s.storage.readVersion.mockImplementation(async function* () { throw new Error(mode === 'missing' ? 'FILE_OBJECT_TRUNCATED' : 'offline'); });
    await expect(s.service.pdf(actor, id, {}, 't')).rejects.toMatchObject({ status: mode === 'offline' ? 503 : 409 });
    expect(s.audit.record).not.toHaveBeenCalled();
  }
});

it('charges repeated image pixels before worker decoding', async () => {
  const s = setup(true), header = Buffer.from(png.subarray(0, 33)); header.writeUInt32BE(4000, 16); header.writeUInt32BE(4000, 20);
  s.ref.sizeBytes = header.length; s.ref.sha256 = createHash('sha256').update(header).digest('hex');
  (s.result.snapshot as any).document.temporaryMeasures = Array.from({ length: 3 }, (_, index) => ({ id: `m-${index}`, description: '', departmentOwner: '', introducedAt: null, fileIds: [fileId] }));
  s.storage.readVersion.mockImplementation(async function* () { yield header; });
  await expect(s.service.pdf(actor, id, {}, 't')).rejects.toMatchObject({ status: 413 });
  expect(s.core.readReport).toHaveBeenCalledTimes(1);
});

it('bounds storage bytes even when oversized decoded images are ultimately listed rather than embedded', async () => {
  const s = setup(true), oversized = Buffer.alloc(8 * 1024 * 1024); png.copy(oversized); oversized.writeUInt32BE(9000, 16);
  const ids = Array.from({ length: 5 }, randomUUID); (s.result.snapshot as any).document.okFileIds = ids;
  s.ref.sizeBytes = oversized.length; s.ref.sha256 = createHash('sha256').update(oversized).digest('hex');
  s.files.readReportEvidence.mockImplementation(async () => ids.map(id => ({ ...s.ref, id })));
  s.storage.readVersion.mockImplementation(async function* () { yield oversized; });
  await expect(s.service.pdf(actor, id, {}, 'bounded-input')).rejects.toMatchObject({ status: 413 });
  expect(s.storage.readVersion).toHaveBeenCalledTimes(4); expect(s.audit.record).not.toHaveBeenCalled();
});

it('maps actual worker page-budget failure to the registered PDF limit error', async () => {
  const s = setup();
  Object.assign((s.result.snapshot as any).document, { description: '\n'.repeat(9000), analysisProcess: '\n'.repeat(9000) });
  await expect(s.service.pdf(actor, id, {}, 'page-limit')).rejects.toMatchObject({ status: 413, response: { code: 'SUPPLIER_EIGHT_D_REPORT_PDF_LIMIT' } });
  expect(s.audit.record).not.toHaveBeenCalled();
}, 30_000);

it.each(['HEADER', 'DECODE'] as const)('maps real %s image failure to a safe registered image/render error', async mode => {
  const s = setup(true), bad = Buffer.from(png);
  if (mode === 'HEADER') bad.fill(0, 0, 8); else bad.fill(0, 41, 47);
  s.ref.sha256 = createHash('sha256').update(bad).digest('hex');
  s.storage.readVersion.mockImplementation(async function* () { yield bad; });
  await expect(s.service.pdf(actor, id, {}, 'bad-image')).rejects.toMatchObject({ status: 422,
    response: { code: mode === 'HEADER' ? 'SUPPLIER_EIGHT_D_REPORT_IMAGE_INVALID' : 'SUPPLIER_EIGHT_D_REPORT_RENDER_FAILED' } });
  expect(s.audit.record).not.toHaveBeenCalled();
});

it.each(['read', 'pdf'] as const)('%s rechecks permissions and server/publication fingerprint, preserving final failure after rollback', async method => {
  for (const mode of ['permission', 'body', 'publication', 'file', 'session']) {
    const s = setup(true);
    if (mode === 'permission') s.tx.$queryRaw.mockResolvedValueOnce([{ allowed: true }]).mockResolvedValueOnce([{ allowed: false }]);
    s.core.readReport.mockImplementation(async () => {
      const result = structuredClone(s.result);
      if (s.core.readReport.mock.calls.length === 2) {
        if (mode === 'body') (result.snapshot as any).document.description = 'new private text';
        if (mode === 'publication') result.versionFingerprint = 'publication-withdrawn';
        if (mode === 'file') s.ref.version++;
        if (mode === 'session') throw new HttpException({ code: 'AUTH_SESSION_REQUIRED', message: 'secret' }, 401);
      }
      return result;
    });
    await expect(s.service[method](actor, id, {}, 'same-trace')).rejects.toMatchObject({ status: mode === 'permission' ? 403 : mode === 'session' ? 401 : 409 });
    expect(s.audit.record).toHaveBeenCalledTimes(1);
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUPPLIER_EIGHT_D_REPORT_REJECTED', outcome: 'DENIED', traceId: 'same-trace' }));
    expect(JSON.stringify(s.audit.record.mock.calls)).not.toContain('secret');
  }
});
