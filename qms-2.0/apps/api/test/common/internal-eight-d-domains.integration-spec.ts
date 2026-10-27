import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ProblemQueryService } from '../../src/modules/problem-index/problem-query.service.js';
import { ProblemIndexQueryDto } from '../../src/modules/problem-index/problem-index.dto.js';
import { CustomerComplaintProcessingService } from '../../src/modules/customer-quality/customer-complaint-processing.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import { WorkflowDeadlineExtensionService } from '../../src/modules/workflow/workflow-deadline-extension.service.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import { FileVerificationService } from '../../src/modules/file-management/file-verification.service.js';
import { FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { internalEightDSql } from '../../src/common/eight-d/internal-eight-d-domain.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { completeDocument, domainFixture, type DomainFixture, type DomainName } from './internal-eight-d-domains.fixture.js';
import { png } from '../process-quality/process-eight-d-pdf.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Real internal 8D chains require leased disposable loopback PostgreSQL, never preview 55440.');
}

describe('customer and new-product real internal 8D domain chains', () => {
  let app: INestApplication;
  let customerEvidence: { fileId: string; problemId: string };
  const fixtures = new Map<DomainName, DomainFixture>();
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    for (const domain of ['customer-quality', 'new-product-quality'] as const) fixtures.set(domain, await domainFixture(app, domain));
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  describe.each(['customer-quality', 'new-product-quality'] as const)('%s', domain => {
    let f: DomainFixture, id: string, matrixId: string;
    let signed: Awaited<ReturnType<DomainFixture['rounds']['decide']>>;
    let approved: Awaited<ReturnType<DomainFixture['runtime']['report']['read']>>;
    let extensionBefore: Awaited<ReturnType<DomainFixture['read']>>;
    let extensionLeader: Awaited<ReturnType<WorkflowDeadlineExtensionService['decide']>>;
    let returnedRound: typeof signed;
    let upload: Awaited<ReturnType<FileLifecycleService['initializeUpload']>>;
    beforeAll(() => { f = fixtures.get(domain)!; });
    const decide = (actor: DomainFixture['owner']['actor'], round: NonNullable<typeof signed>, duties: ('PROFESSIONAL' | 'SECTION_MANAGER')[], decision: 'APPROVE' | 'RETURN' = 'APPROVE') =>
      f.rounds.decide(actor, round.id, { expectedRoundVersion: round.version, duties, decision, comment: 'Actual domain evidence reviewed' }, randomUUID(), randomUUID());
    const projection = async (problemId = id) => {
      const round = await f.rounds.readProjection(f.prisma, f.org.id, problemId);
      expect(round).not.toBeNull();
      return round!;
    };
    const chainDocument = () => {
      const document = completeDocument(domain);
      if (domain === 'customer-quality' && customerEvidence) document.okFileIds = [customerEvidence.fileId];
      return document;
    };

    it('issues from actual unanalysed sources with the real issuer as professional', async () => {
      const reference = await f.reference(f.chainSource);
      if (domain === 'customer-quality') {
        const source = await f.prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: f.chainSource.factId } });
        expect(source.qualityEngineerId).toBe(f.owner.user.id);
        expect(source.qualityEngineerId).not.toBe(f.professional.user.id);
        expect(reference.sourceSnapshot).toMatchObject({ analyses: { fae: null, supplier: null } });
      } else {
        expect(f.chainSource.sourceId).not.toBe(f.chainSource.factId);
        expect(reference).toMatchObject({ sourceType: 'new-product-defect-selection', sourceId: f.chainSource.sourceId,
          sourceSnapshot: { selectionId: f.chainSource.sourceId, id: f.chainSource.factId } });
      }
      id = await f.issue([f.chainSource]);
      const current = await f.read(id);
      expect(current).toMatchObject({ status: 'PROCESSING', professionalUserId: f.professional.user.id, ownerUserId: f.owner.user.id });
      expect(current.sources).toMatchObject([{ sourceId: f.chainSource.sourceId, snapshot: reference.sourceSnapshot }]);
      await expect(f.service.save(f.professional.actor, id, { expectedVersion: current.version, document: completeDocument(domain) }, randomUUID(), randomUUID()))
        .rejects.toMatchObject({ status: 403 });
      await expect(f.service.submit(f.owner.actor, id, { expectedVersion: current.version }, randomUUID(), randomUUID()))
        .rejects.toMatchObject({ status: 400 });
    });

    it('saves the actual complete D2 through D8 document', async () => {
      const current = await f.read(id);
      const saved = await f.service.save(f.owner.actor, id, { expectedVersion: current.version, document: completeDocument(domain) }, randomUUID(), randomUUID());
      expect(saved.document).toEqual(completeDocument(domain));
    });

    it('records actual analysis completion and the first submission plan', async () => {
      let current = await f.read(id);
      current = await f.service.analysisComplete(f.owner.actor, id,
        { expectedVersion: current.version, submissionDueAt: new Date('2026-11-10T00:00:00Z') }, randomUUID(), randomUUID());
      expect(current.analysisCompletedAt).not.toBeNull();
    });

    it('projects the current owner handling task with the controlled submission action', async () => {
      expect((await f.runtime.tasks.list(f.owner.actor, { problemId: id })).items).toEqual(expect.arrayContaining([
        expect.objectContaining({ problemId: id, kind: 'HANDLING', stage: 'SUBMISSION', actions: expect.arrayContaining(['SUBMIT']) }),
      ]));
    });

    if (domain === 'customer-quality') {
      it('uploads real customer bytes to versioned storage and completes the upload', async () => {
        const files = app.get(FileLifecycleService);
        const sha256 = createHash('sha256').update(png).digest('hex');
        upload = await files.initializeUpload(f.owner.actor, { resourceType: 'customer-eight-d', resourceId: id,
          originalName: 'domain-chain-real.png', contentType: 'image/png', sizeBytes: png.length, sha256 }, randomUUID(), randomUUID());
        expect((await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: png })).status).toBe(200);
        await files.complete(f.owner.actor, upload.file.id, upload.file.version, randomUUID(), randomUUID());
      });

      it('scans the uploaded customer object through the real ClamAV worker', async () => {
        const sha256 = createHash('sha256').update(png).digest('hex');
        const [{ now }] = await f.prisma.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS "now"`;
        const offset = now.getTime() - Date.now() + 1000;
        const scanner = new FileScanWorkerService(f.prisma, app.get(FileVerificationService), app.get(AuditLogService), () => new Date(Date.now() + offset));
        await scanner.processDue(100);
        const file = await f.prisma.fileObject.findUniqueOrThrow({ where: { id: upload.file.id } });
        expect(file).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN', verifiedSha256: sha256, verifiedContentType: 'image/png' });
        expect(file.scannerEngine).toMatch(/^ClamAV /);
        expect(file.objectVersionId).toBeTruthy();
        customerEvidence = { fileId: file.id, problemId: id };
        console.info('N4 actual customer file evidence', { ...customerEvidence, sha256, scannerEngine: file.scannerEngine, objectVersionId: file.objectVersionId });
      });

      it('attaches the actual CLEAN customer object to its owning report', async () => {
        const current = await f.read(id);
        const saved = await f.service.save(f.owner.actor, id, { expectedVersion: current.version, document: chainDocument() }, randomUUID(), randomUUID());
        expect(saved.document.okFileIds).toEqual([customerEvidence.fileId]);
      });
    } else {
      it('rejects customer evidence under the new-product resource without changing the report', async () => {
        const customer = fixtures.get('customer-quality')!;
        // The rightful owner and original organization stay unchanged: only the resource type is forged.
        await expect(f.prisma.$transaction(tx => app.get(FileResourceAccess).authorizeAndLock(tx, customer.owner.actor,
          { resourceType: 'new-product-eight-d', resourceId: customerEvidence.problemId }, 'read')))
          .rejects.toMatchObject({ status: 404 });
        const before = await f.read(id), document = completeDocument(domain);
        document.okFileIds = [customerEvidence.fileId];
        await expect(f.service.save(f.owner.actor, id, { expectedVersion: before.version, document }, randomUUID(), randomUUID()))
          .rejects.toMatchObject({ status: 409, response: { code: 'PROCESS_EIGHT_D_EVIDENCE_NOT_CLEAN' } });
        expect(await f.read(id)).toEqual(before);
      });
    }

    it('keeps source edits and NEW_PRODUCT to MASS_PRODUCTION drift out of the in-flight snapshot', async () => {
      const before = await f.read(id);
      if (domain === 'customer-quality') await f.customer.update(f.owner.actor, f.chainSource.factId,
        { expectedVersion: f.chainSource.expectedVersion, fields: { quantity: 7 } }, randomUUID(), randomUUID());
      else {
        await f.process.update(f.manager.actor, f.chainSource.factId,
          { expectedVersion: f.chainSource.expectedVersion, defectQuantity: 7 }, randomUUID(), randomUUID());
        await f.mappings.updateProject(f.professional.actor, f.org.id, f.projectRecord.id,
          { expectedVersion: f.projectRecord.version, stage: 'MASS_PRODUCTION' }, randomUUID(), randomUUID());
        const afterMass = await f.process.create(f.manager.actor, { description: 'After mass-production', productCode: f.productCode }, randomUUID(), randomUUID());
        await expect(f.quality.selectProcessDefect(f.professional.actor, f.project.id,
          { defectId: afterMass.id, expectedVersion: afterMass.version }, randomUUID(), randomUUID()))
          .rejects.toMatchObject({ status: 409, response: { code: 'NEW_PRODUCT_DEFECT_STAGE_INELIGIBLE' } });
      }
      expect((await f.read(id)).sources).toEqual(before.sources);
      expect((await f.read(id)).contentVersion).toBe(before.contentVersion);
    });

    it('submits to actual parallel duties and never closes after only the professional approval', async () => {
      const before = await f.read(id);
      const current = await f.service.submit(f.owner.actor, id, { expectedVersion: before.version }, randomUUID(), randomUUID());
      expect(current.status).toBe('IN_REVIEW');
      const round = await projection();
      expect(round.duties).toEqual(expect.arrayContaining([
        expect.objectContaining({ duty: 'PROFESSIONAL', status: 'PENDING' }),
        expect.objectContaining({ duty: 'SECTION_MANAGER', status: 'PENDING' }),
      ]));
      await expect(f.service.save(f.owner.actor, id, { expectedVersion: current.version, document: completeDocument(domain) }, randomUUID(), randomUUID()))
        .rejects.toMatchObject({ status: 409 });
      signed = await decide(f.professional.actor, round, ['PROFESSIONAL']);
      expect(signed.status).toBe('PENDING');
      expect((await f.read(id)).status).toBe('IN_REVIEW');
      expect((await f.prisma.problemIndex.findUniqueOrThrow({ where: { id } })).closedAt).toBeNull();
    });

    it('immediately revokes domain read/report/tasks without treating workflow grants as business permission', async () => {
      const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: `${domain}:issues:read` } });
      await f.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
      try {
        await expect(f.read(id)).rejects.toMatchObject({ status: 403 });
        await expect(f.runtime.report.read(f.owner.actor, id, { view: 'CURRENT' }, randomUUID())).rejects.toMatchObject({ status: 403 });
        expect(await f.runtime.tasks.list(f.owner.actor, { problemId: id })).toEqual({ items: [], total: 0 });
      } finally { await f.prisma.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } }); }
    });

    it('requests an extension and records the leader approval without changing the original deadline', async () => {
      const extensions = app.get(WorkflowDeadlineExtensionService), before = extensionBefore = await f.read(id);
      const requestedDueAt = '2027-01-15T00:00:00.000Z';
      const request = await extensions.request(f.owner.actor, id,
        { expectedRowVersion: before.version, expectedInstanceVersion: before.instanceVersion, stage: 'CLOSURE', requestedDueAt,
          reason: 'Measured verification needs additional follow-up' }, randomUUID(), randomUUID());
      const leader = extensionLeader = await extensions.decide(f.manager.actor, request.id,
        { expectedVersion: request.version, decision: 'APPROVE' }, randomUUID(), randomUUID());
      expect(leader.status).toBe('QUALITY_PENDING');
      expect((await f.read(id)).closureDueAt).toBe(before.closureDueAt);
      expect((await f.prisma.problemIndex.findUniqueOrThrow({ where: { id } })).dueAt?.toISOString()).toBe(before.closureDueAt);
      expect((await f.runtime.tasks.list(f.professional.actor, { problemId: id })).items)
        .toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'EXTENSION', extensionRequestId: request.id })]));
    });

    it('applies the extension after the professional approval while preserving the existing closure signature', async () => {
      const extensions = app.get(WorkflowDeadlineExtensionService), before = extensionBefore, leader = extensionLeader;
      const requestedDueAt = '2027-01-15T00:00:00.000Z';
      const extension = await extensions.decide(f.professional.actor, leader.id,
        { expectedVersion: leader.version, decision: 'APPROVE' }, randomUUID(), randomUUID());
      expect(extension.status).toBe('APPROVED');
      expect((await f.read(id))).toMatchObject({ closureDueAt: requestedDueAt, contentVersion: before.contentVersion });
      expect((await f.prisma.problemIndex.findUniqueOrThrow({ where: { id } })).dueAt?.toISOString()).toBe(requestedDueAt);
      expect((await projection()).duties).toEqual(signed.duties);
      expect((await extensions.history(f.owner.actor, id))[0]).toMatchObject({ id: leader.id, originalDueAt: before.closureDueAt, requestedDueAt });
    });

    it('closes only after the other actual duty and stores an immutable complete approved revision', async () => {
      const result = await decide(f.manager.actor, await projection(), ['SECTION_MANAGER']);
      expect(result.status).toBe('APPROVED');
      const closed = await f.read(id);
      expect(closed.status).toBe('CLOSED');
      expect(closed.closedRevisionId).not.toBeNull();
      approved = await f.runtime.report.read(f.owner.actor, id, { view: 'APPROVED' }, randomUUID());
      expect(approved).toMatchObject({ problemId: id, revisionId: closed.closedRevisionId, status: 'APPROVED', view: 'APPROVED',
        snapshot: { document: chainDocument(), professionalUserId: f.professional.user.id } });
      if (domain === 'customer-quality') expect(approved.attachments).toMatchObject([{ id: customerEvidence.fileId, rendering: 'EMBEDDED' }]);
      const table = internalEightDSql(f.runtime.core.domain).revisions;
      await expect(f.prisma.$executeRaw`UPDATE ${table} SET snapshot = '{}'::jsonb WHERE id = ${closed.closedRevisionId}::uuid`).rejects.toThrow();
      expect((await f.runtime.tasks.list(f.owner.actor, { problemId: id })).items).toEqual([]);
    });

    it('renders a real approved PDF containing the domain and saved document, not merely a PDF header', async () => {
      const pdf = await f.runtime.report.pdf(f.owner.actor, id, { view: 'APPROVED' }, randomUUID());
      expect(pdf.contentType).toBe('application/pdf');
      expect(pdf.content.subarray(0, 5).toString()).toBe('%PDF-');
      if (process.env.QMS_DOMAIN_CHAIN_EVIDENCE_DIR) {
        await writeFile(join(process.env.QMS_DOMAIN_CHAIN_EVIDENCE_DIR, `${domain}-approved.pdf`), pdf.content);
        await writeFile(join(process.env.QMS_DOMAIN_CHAIN_EVIDENCE_DIR, `${domain}-approved.json`), JSON.stringify(approved, null, 2));
      }
      const loading = getDocument({ data: new Uint8Array(pdf.content), useSystemFonts: false });
      try {
        const document = await loading.promise;
        let text = '', images = 0;
        for (let page = 1; page <= document.numPages; page++) {
          const pdfPage = await document.getPage(page), content = await pdfPage.getTextContent();
          text += content.items.map(item => 'str' in item ? item.str : '').join(' ');
          images += (await pdfPage.getOperatorList()).fnArray.filter(operation => operation === OPS.paintImageXObject || operation === OPS.paintInlineImageXObject).length;
        }
        expect(text).toContain(approved.reportNumber);
        expect(text.replace(/\s+/g, '')).toContain(completeDocument(domain).description.replace(/\s+/g, ''));
        expect(text).toContain('Measured occurrence cause');
        expect(document.numPages).toBeGreaterThan(0);
        if (domain === 'customer-quality') expect(images).toBeGreaterThan(0);
      } finally { await loading.destroy(); }
      if (domain === 'customer-quality') {
        const grant = await app.get(FileLifecycleService).download(f.owner.actor, customerEvidence.fileId, randomUUID());
        const response = await fetch(grant.url);
        expect(response.status).toBe(200);
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(bytes).toEqual(png);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(approved.attachments[0]!.sha256);
      }
    });

    it('keeps approved and historical report snapshots frozen when a closed report receives another source', async () => {
      const before = await f.read(id);
      await f.service.sources(f.professional.actor, id, { expectedVersion: before.version,
        add: [{ sourceId: f.extra.sourceId, expectedVersion: f.extra.expectedVersion }], removeSourceIds: [] }, randomUUID(), randomUUID());
      const current = await f.runtime.report.read(f.owner.actor, id, { view: 'CURRENT' }, randomUUID());
      expect(current.status).toBe('CLOSED_SUPPLEMENT');
      expect(current.snapshot.sources).toHaveLength(2);
      expect(current.contentVersion).toBe(approved.contentVersion);
      expect((await f.runtime.report.read(f.owner.actor, id, { view: 'APPROVED' }, randomUUID())).snapshot).toEqual(approved.snapshot);
      const historical = await f.runtime.report.read(f.owner.actor, id, { revisionId: approved.revisionId! }, randomUUID());
      expect(historical).toMatchObject({ view: 'HISTORICAL', snapshot: approved.snapshot });
      await expect(f.service.save(f.owner.actor, id, { expectedVersion: (await f.read(id)).version, document: completeDocument(domain) }, randomUUID(), randomUUID()))
        .rejects.toMatchObject({ status: 409 });
    });

    it('issues multiple real sources and rejects missing or false previous-problem confirmations', async () => {
      matrixId = await f.issue(f.matrixSources);
      expect((await f.read(matrixId)).sources).toHaveLength(2);
      const selected = f.matrixSources[0]!;
      await expect(f.issue([selected])).rejects.toMatchObject({ status: 409 });
      await expect(f.service.issue(f.professional.actor, { ...f.input([selected]),
        sourceConfirmations: [{ sourceId: selected.sourceId, relatedProblemIds: [randomUUID()], recurrence: 'NOT_RECURRENCE' }] }, randomUUID(), randomUUID()))
        .rejects.toMatchObject({ status: 409 });
    });

    it('accepts the exact human confirmation for another report without collapsing its independent source set', async () => {
      const selected = f.matrixSources[0]!;
      const second = await f.service.issue(f.professional.actor, { ...f.input([selected]),
        sourceConfirmations: [{ sourceId: selected.sourceId, relatedProblemIds: [matrixId], recurrence: 'NOT_RECURRENCE' }] }, randomUUID(), randomUUID());
      expect(second.problem.id).not.toBe(matrixId);
      const confirmationTable = internalEightDSql(f.runtime.core.domain).sourceConfirmations;
      const [confirmation] = await f.prisma.$queryRaw<{ recurrence: string; actor: string }[]>`
        SELECT recurrence, actor_user_id AS actor FROM ${confirmationTable} WHERE problem_id = ${String(second.problem.id)}::uuid`;
      expect(confirmation).toEqual({ recurrence: 'NOT_RECURRENCE', actor: f.professional.user.id });
      expect((await f.runtime.report.read(f.owner.actor, String(second.problem.id), { view: 'CURRENT' }, randomUUID())).snapshot.sources).toHaveLength(1);
      await expect(f.service.sources(f.professional.actor, matrixId, { expectedVersion: (await f.read(matrixId)).version,
        add: [], removeSourceIds: f.matrixSources.map(s => s.sourceId) }, randomUUID(), randomUUID()))
        .rejects.toMatchObject({ status: 409 });
    });

    it('changes the primary source without rewriting facts and enforces row CAS', async () => {
      const before = await f.read(matrixId), a = f.matrixSources[0]!, b = f.matrixSources[1]!;
      const facts = await Promise.all(f.matrixSources.map(source => f.reference(source)));
      const current = await f.service.sources(f.professional.actor, matrixId, { expectedVersion: before.version,
        add: [], removeSourceIds: [a.sourceId], primarySourceId: b.sourceId }, randomUUID(), randomUUID());
      expect(current.sources).toMatchObject([{ sourceId: b.sourceId, primary: true }]);
      await expect(f.service.sources(f.professional.actor, matrixId, { expectedVersion: before.version,
        add: [], removeSourceIds: [], primarySourceId: b.sourceId }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
      expect(await Promise.all(f.matrixSources.map(source => f.reference(source)))).toEqual(facts);
    });

    it('allows the appointed collaborator to edit but never submit the whole report', async () => {
      let current = await f.read(matrixId);
      current = await f.service.collaborators(f.owner.actor, matrixId,
        { expectedVersion: current.version, userIds: [f.minister.user.id] }, randomUUID(), randomUUID());
      current = await f.service.save(f.minister.actor, matrixId,
        { expectedVersion: current.version, document: completeDocument(domain) }, randomUUID(), randomUUID());
      await expect(f.service.submit(f.minister.actor, matrixId, { expectedVersion: current.version }, randomUUID(), randomUUID()))
        .rejects.toMatchObject({ status: 403 });
    });

    it('revokes collaborator editing immediately when the owner removes the appointment', async () => {
      let current = await f.read(matrixId);
      current = await f.service.collaborators(f.owner.actor, matrixId,
        { expectedVersion: current.version, userIds: [] }, randomUUID(), randomUUID());
      await expect(f.service.save(f.minister.actor, matrixId,
        { expectedVersion: current.version, document: completeDocument(domain) }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    });

    it('prepares and submits the independent multisource report for its actual first review', async () => {
      let current = await f.read(matrixId);
      current = await f.service.save(f.owner.actor, matrixId, { expectedVersion: current.version, document: completeDocument(domain) }, randomUUID(), randomUUID());
      current = await f.service.analysisComplete(f.owner.actor, matrixId,
        { expectedVersion: current.version, submissionDueAt: new Date('2026-11-10T00:00:00Z') }, randomUUID(), randomUUID());
      await f.service.submit(f.owner.actor, matrixId, { expectedVersion: current.version }, randomUUID(), randomUUID());
      expect((await f.read(matrixId)).status).toBe('IN_REVIEW');
    });

    it('returns the whole first review round after a real professional signature', async () => {
      const first = await projection(matrixId);
      const one = returnedRound = await decide(f.professional.actor, first, ['PROFESSIONAL']);
      await decide(f.manager.actor, one, ['SECTION_MANAGER'], 'RETURN');
      const current = await f.read(matrixId);
      expect(current.status).toBe('PROCESSING');
    });

    it('edits and resubmits the returned report with neither previous approval carried forward', async () => {
      let current = await f.read(matrixId);
      const document = completeDocument(domain); document.description = 'Returned report supplemented with measured evidence';
      current = await f.service.save(f.owner.actor, matrixId, { expectedVersion: current.version, document }, randomUUID(), randomUUID());
      await f.service.submit(f.owner.actor, matrixId, { expectedVersion: current.version }, randomUUID(), randomUUID());
      const next = await projection(matrixId);
      expect(next.roundNumber).toBe(returnedRound.roundNumber + 1);
      expect(next.duties.every(duty => duty.status === 'PENDING')).toBe(true);
      expect(next.id).not.toBe(returnedRound.id);
      await expect(decide(f.manager.actor, returnedRound, ['SECTION_MANAGER'])).rejects.toMatchObject({ status: 409 });
      expect((await f.rounds.history(f.owner.actor, matrixId))).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: returnedRound.id, status: 'RETURNED' }), expect.objectContaining({ id: next.id, status: 'PENDING' }),
      ]));
    });

    it('rejects ungranted, expired-session, supplier, other-organization, archived-source and stale source commands without new problems', async () => {
      const other = fixtures.get(domain === 'customer-quality' ? 'new-product-quality' : 'customer-quality')!;
      const before = await f.prisma.problemIndex.count({ where: { organizationId: f.org.id } });
      for (const actor of [f.ungranted.actor, f.supplier]) {
        await expect(f.service.issue(actor, f.input([f.archived]), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
        await expect(f.service.read(actor, id)).rejects.toMatchObject({ status: 403 });
      }
      await expect(f.service.issue(other.professional.actor, f.input([f.chainSource]), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
      await expect(f.service.issue(f.professional.actor, f.input([f.archived]), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
      await expect(f.service.issue(f.professional.actor, f.input([{ ...f.matrixSources[1]!, expectedVersion: 999 }]), randomUUID(), randomUUID()))
        .rejects.toMatchObject({ status: 409 });
      await expect(f.service.read({ ...f.owner.actor, sessionId: randomUUID() }, id)).rejects.toMatchObject({ status: 401 });
      await expect(other.service.read(f.owner.actor, id)).rejects.toMatchObject({ status: 404 });
      await expect(f.runtime.report.read(other.owner.actor, id, { view: 'APPROVED' }, randomUUID())).rejects.toMatchObject({ status: 404 });
      expect(await f.prisma.problemIndex.count({ where: { organizationId: f.org.id } })).toBe(before);
    });

    it('rejects generic controlled start/action and the old domain execution entry without mutation', async () => {
      const runtime = app.get(WorkflowRuntimeService), prisma = app.get(PrismaService);
      const current = await f.read(matrixId);
      const instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: current.instanceId } });
      const problem = await prisma.problemIndex.findUniqueOrThrow({ where: { id: matrixId } });
      const command = { organizationId: f.org.id, actor: f.professional.actor, problemIndexId: matrixId,
        ...f.workflowBinding, expectedProblemVersion: problem.version, idempotencyKey: randomUUID(), traceId: randomUUID() };
      // Existing instances fail CAS before reaching the generic controlled-start guard.
      await expect(runtime.startInstance(command)).rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
      const unbound = await prisma.problemIndex.create({ data: { organizationId: f.org.id, reportNumber: randomUUID(),
        domainCode: domain, problemType: f.runtime.core.domain.problemType, sourceType: f.runtime.core.domain.sourceType,
        sourceId: f.matrixSources[1]!.sourceId, severity: 'LOW', createdById: f.professional.user.id } });
      await expect(runtime.startInstance({ ...command, problemIndexId: unbound.id, expectedProblemVersion: unbound.version,
        idempotencyKey: randomUUID(), instanceKey: randomUUID() })).rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_ACTION_INVALID' } });
      expect(await prisma.workflowInstance.count({ where: { problemIndexId: unbound.id } })).toBe(0);
      expect(await prisma.problemIndex.findUniqueOrThrow({ where: { id: unbound.id } })).toEqual(unbound);
      await expect(runtime.submitAction({ ...command, instanceId: instance.id, currentNodeId: instance.currentNodeId!,
        expectedVersion: instance.version, action: 'APPROVE' })).rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_ACTION_INVALID' } });
      if (domain === 'customer-quality') {
        await expect(app.get(CustomerComplaintProcessingService).eightD(f.professional.actor, f.matrixSources[1]!.factId))
          .rejects.toMatchObject({ status: 409 });
      } else {
        await expect(f.quality.issueSelectedDefects(f.professional.actor, f.project.id,
          { selectionIds: [f.matrixSources[1]!.sourceId], severity: 'LOW', complexity: 'COMPLEX', workflowBinding: f.workflowBinding }, randomUUID(), randomUUID()))
          .rejects.toMatchObject({ status: 409 });
        const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM new_product_issues WHERE organization_id = ${f.org.id}::uuid`;
        expect(count).toBe(0);
      }
      expect(await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } })).toEqual(instance);
      expect(await prisma.problemIndex.findUniqueOrThrow({ where: { id: matrixId } })).toEqual(problem);
    });

    if (domain === 'new-product-quality') {
      it('filters selection versus legacy source types before pagination, total and status counts', async () => {
        const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'problem-index:read' } });
        await f.prisma.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } });
        // Reuse the existing project and neutral index; only one legacy source row is needed.
        const legacyIssueId = randomUUID();
        await f.prisma.$executeRaw`INSERT INTO new_product_issues
          (id, organization_id, project_id, response_form, complexity, severity, created_by_id, problem_index_id)
          VALUES (${legacyIssueId}::uuid, ${f.org.id}::uuid, ${f.project.id}::uuid, 'BRIEF', 'SIMPLE', 'LOW',
            ${f.professional.user.id}::uuid, ${f.problem.id}::uuid)`;
        const legacy = await f.prisma.problemIndex.update({ where: { id: f.problem.id }, data: {
          domainCode: domain, problemType: 'NEW_PRODUCT_ISSUE', sourceType: 'new-product-issue', sourceId: legacyIssueId,
          status: 'OPEN', createdAt: new Date('2000-01-01T00:00:00Z'),
        } });
        const selected = await f.prisma.problemIndex.findMany({ where: { organizationId: f.org.id, domainCode: domain,
          problemType: 'NEW_PRODUCT_ISSUE', sourceType: 'new-product-defect-selection' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        expect(selected.length).toBeGreaterThanOrEqual(2);
        expect(selected.some(problem => problem.id === id && problem.status === 'CLOSED')).toBe(true);
        const counts = [...new Set(selected.map(problem => problem.status))].map(status => ({
          status, count: selected.filter(problem => problem.status === status).length,
        }));
        const query = app.get(ProblemQueryService);
        const input = (sourceType: string, page = 1) => Object.assign(new ProblemIndexQueryDto(), {
          domainCode: domain, problemType: 'NEW_PRODUCT_ISSUE', sourceType, page, pageSize: 1, sortBy: 'createdAt', sortDirection: 'asc',
        });
        const first = await query.list(f.owner.actor, input('new-product-defect-selection'));
        const second = await query.list(f.owner.actor, input('new-product-defect-selection', 2));
        expect(first).toMatchObject({ total: selected.length, page: 1, pageSize: 1,
          items: [{ id: selected[0]!.id, sourceType: 'new-product-defect-selection' }] });
        expect(second).toMatchObject({ total: selected.length, page: 2, pageSize: 1,
          items: [{ id: selected[1]!.id, sourceType: 'new-product-defect-selection' }] });
        expect(first.items).toHaveLength(1); expect(second.items).toHaveLength(1);
        // PostgreSQL enum order differs from text order; compare the complete status/count sets.
        expect(first.statusCounts).toHaveLength(counts.length); expect(second.statusCounts).toHaveLength(counts.length);
        expect(first.statusCounts).toEqual(expect.arrayContaining(counts));
        expect(second.statusCounts).toEqual(expect.arrayContaining(counts));
        expect([...first.items, ...second.items].map(problem => problem.id)).not.toContain(legacy.id);
        expect(await query.list(f.owner.actor, input('new-product-issue'))).toMatchObject({ total: 1,
          statusCounts: [{ status: 'OPEN', count: 1 }], page: 1, pageSize: 1, items: [{ id: legacy.id, sourceType: 'new-product-issue' }] });
      });
    }
  });
});
