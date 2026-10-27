import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import type { FileEvidenceDto } from '../file-management/file.dto.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../file-management/object-storage.service.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { canonical, isClosureReviewNode } from '../workflow/workflow-runtime-policy.js';
import { documentFileIds, normalizeProcessEightDDocument, ProcessEightDDocumentError } from './process-eight-d-document.js';
import { PROCESS_EIGHT_D_MAX_FILES } from './process-eight-d-document.dto.js';
import { ProcessEightDService } from './process-eight-d.service.js';
import type { AdminActor as ProcessEightDActor } from '../../common/security/admin-mutation.service.js';
import { INTERNAL_EIGHT_D_REPORT_DOMAIN, type InternalEightDReportCore, type InternalEightDReportDescriptor } from '../../common/eight-d/internal-eight-d-report.js';
import { INTERNAL_EIGHT_D_DOMAINS } from '../../common/eight-d/internal-eight-d-domain.js';
export type { InternalEightDReportCore, InternalEightDReportDescriptor } from '../../common/eight-d/internal-eight-d-report.js';
import { ProcessEightDControlledReportDto, type ProcessEightDReportAttachmentDto, type ProcessEightDReportQueryDto, type ProcessEightDReportSnapshotDto } from './process-eight-d-report.dto.js';
import { REPORT_IMAGE_MAX_BYTES, REPORT_TOTAL_IMAGE_BYTES, REPORT_TOTAL_IMAGE_PIXELS, renderProcessEightDPdf, reportImageSize } from './process-eight-d-pdf.js';

type ReadResult = Awaited<ReturnType<InternalEightDReportCore['readReport']>>;
type FileReference = FileEvidenceDto & { objectKey: string; objectVersionId: string };
type Selection = { result: ReadResult; refs: FileReference[]; report: ProcessEightDControlledReportDto; fingerprint: string };

export function reportAttachmentUses(document: ProcessEightDReportSnapshotDto['document']): Map<string, string[]> {
  const uses = new Map<string, string[]>();
  const add = (ids: string[], purpose: string) => ids.forEach(id => uses.set(id, [...(uses.get(id) ?? []), purpose]));
  add(document.okFileIds, 'D2 OK'); add(document.ngFileIds, 'D2 NG'); add(document.analysisFileIds, 'D4 分析');
  document.temporaryMeasures.forEach(row => add(row.fileIds, `D3 临时措施 ${row.id}`));
  document.correctiveActions.forEach(row => { add(row.fileIds, `D5 / D6 措施 ${row.id}`); add(row.verificationFileIds, `D6 验证 ${row.id}`); });
  document.horizontalDeployment.forEach(row => add(row.fileIds, `D7 横展 ${row.id}`));
  return uses;
}

@Injectable()
export class ProcessEightDReportService {
  private readonly domain: InternalEightDReportDescriptor;
  constructor(private readonly prisma: PrismaService, @Inject(ProcessEightDService) private readonly core: InternalEightDReportCore, private readonly files: FileLifecycleService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage, private readonly audit: AuditLogService,
    @Optional() @Inject(INTERNAL_EIGHT_D_REPORT_DOMAIN) domain?: InternalEightDReportDescriptor) {
    const requested = domain ?? INTERNAL_EIGHT_D_DOMAINS.PROCESS;
    const approved = Object.values(INTERNAL_EIGHT_D_DOMAINS).find(value => value.domainCode === requested.domainCode
      && value.resourceType === requested.resourceType && value.permissionPrefix === requested.permissionPrefix);
    if (!approved) throw new Error('INTERNAL_EIGHT_D_REPORT_DOMAIN_INVALID');
    this.domain = approved;
  }

  private code(code: string): string { return code.replace(/^PROCESS_EIGHT_D_REPORT_/, `${this.domain.resourceType.replaceAll('-', '_').toUpperCase()}_REPORT_`); }
  private fail(code: string, status: number): never { const scoped = this.code(code); throw new HttpException({ code: scoped, message: scoped }, status); }
  private object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) this.fail('PROCESS_EIGHT_D_REPORT_SNAPSHOT_INVALID', 409);
    return value as Record<string, unknown>;
  }
  private get auditResource(): string { return `${this.domain.resourceType.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join('')}Report`; }

  async read(actor: ProcessEightDActor, problemId: string, query: ProcessEightDReportQueryDto, traceId: string): Promise<ProcessEightDControlledReportDto> {
    this.validate(actor, problemId, query);
    const selected = await this.transaction(tx => this.select(tx, actor, problemId, query));
    await this.finish(actor, problemId, query, selected, traceId, 'READ');
    return selected.report;
  }

  async pdf(actor: ProcessEightDActor, problemId: string, query: ProcessEightDReportQueryDto, traceId: string): Promise<{ content: Buffer; contentType: 'application/pdf'; filename: string }> {
    this.validate(actor, problemId, query);
    const selected = await this.transaction(tx => this.select(tx, actor, problemId, query));
    // No storage/network access inside database transactions. References are server-owned and fixed first.
    const images = await this.images(selected);
    let content: Buffer;
    try { content = await renderProcessEightDPdf(selected.report, images, this.domain.domainCode); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Error && ['PROCESS_EIGHT_D_REPORT_IMAGE_LIMIT', 'PROCESS_EIGHT_D_REPORT_PDF_LIMIT'].includes(error.message)) this.fail(error.message, 413);
      this.fail('PROCESS_EIGHT_D_REPORT_RENDER_FAILED', 422);
    }
    await this.finish(actor, problemId, query, selected, traceId, 'PDF', content);
    return { content, contentType: 'application/pdf', filename: `${this.domain.resourceType}-${problemId}-v${selected.report.contentVersion}-${selected.report.view.toLowerCase()}.pdf` };
  }

  private validate(actor: ProcessEightDActor, problemId: string, query: ProcessEightDReportQueryDto) {
    if (!isUUID(problemId) || !query || typeof query !== 'object' || Array.isArray(query)
      || Object.keys(query).some(key => !['organizationId', 'revisionId', 'view'].includes(key))
      || query.revisionId !== undefined && !isUUID(query.revisionId)
      || query.organizationId !== undefined && !isUUID(query.organizationId)
      || query.view !== undefined && !['CURRENT', 'APPROVED'].includes(query.view)
      || query.revisionId !== undefined && query.view === 'CURRENT') this.fail('PROCESS_EIGHT_D_REPORT_QUERY_INVALID', 400);
    if (actor.accountType !== 'INTERNAL' || query.organizationId !== undefined && query.organizationId !== (actor.scopeOrganizationId ?? actor.organizationId)) this.fail('ORGANIZATION_SCOPE_DENIED', 403);
  }

  private async select(tx: Prisma.TransactionClient, actor: ProcessEightDActor, problemId: string, query: ProcessEightDReportQueryDto, downloadTraceId?: string): Promise<Selection> {
    const revision = query.revisionId ?? (query.view === 'APPROVED' ? undefined : null);
    // The domain service revalidates the active session/MFA, organization and domain read permission.
    const result = await this.core.readReport(tx, actor, problemId, revision);
    await assertWorkflowFeature(tx, actor, result.record.problem.organizationId, `${this.domain.permissionPrefix}:report`);
    if (query.view === 'APPROVED' && !query.revisionId && !result.revision) this.fail('PROCESS_EIGHT_D_REPORT_APPROVED_UNAVAILABLE', 409);
    const raw = this.object(result.snapshot);
    let normalized;
    try { normalized = normalizeProcessEightDDocument(raw.document); }
    catch (error) {
      if (error instanceof ProcessEightDDocumentError) this.fail(error.issues.some(issue => issue.path === 'fileIds')
        ? 'PROCESS_EIGHT_D_REPORT_EVIDENCE_LIMIT' : 'PROCESS_EIGHT_D_REPORT_SNAPSHOT_INVALID', 409);
      throw error;
    }
    if (canonical(raw.document) !== canonical(normalized) || !Array.isArray(raw.sources)
      || !Number.isSafeInteger(raw.contentVersion) || Number(raw.contentVersion) < 1
      || !Number.isSafeInteger(raw.rowVersion) || Number(raw.rowVersion) < 1) this.fail('PROCESS_EIGHT_D_REPORT_SNAPSHOT_INVALID', 409);
    const problem = this.object(raw.problem); this.object(raw.instance); this.object(raw.deadlines);
    if (typeof problem.reportNumber !== 'string') this.fail('PROCESS_EIGHT_D_REPORT_SNAPSHOT_INVALID', 409);
    const snapshot = raw as unknown as ProcessEightDReportSnapshotDto;
    const ids = documentFileIds(normalized);
    if (ids.length > PROCESS_EIGHT_D_MAX_FILES) this.fail('PROCESS_EIGHT_D_REPORT_EVIDENCE_LIMIT', 409);
    const refs: FileReference[] = ids.length ? await this.files.readReportEvidence(tx, actor,
      [{ resource: { resourceType: this.domain.resourceType, resourceId: problemId }, fileIds: ids }], downloadTraceId) : [];
    if (refs.length !== ids.length || new Set(refs.map(file => file.id)).size !== ids.length) this.fail('FILE_RESOURCE_DENIED', 403);
    for (const file of refs) {
      if (!ids.includes(file.id) || file.resourceType !== this.domain.resourceType || file.resourceId !== problemId) this.fail('FILE_RESOURCE_DENIED', 403);
      if (file.status !== 'AVAILABLE' || file.scanStatus !== 'CLEAN' || !file.downloadable || !file.scannedAt
        || !isUUID(file.objectKey) || !file.objectVersionId || file.objectVersionId === 'null' || file.objectVersionId.length > 1024
        || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > 25 * 1024 * 1024
        || !/^[0-9a-f]{64}$/.test(file.sha256)) this.fail('FILE_NOT_AVAILABLE', 409);
      if (result.revision) {
        const pinned = Array.isArray(raw.evidence) ? raw.evidence.find(value => this.object(value).id === file.id) : undefined;
        if (!pinned) this.fail('PROCESS_EIGHT_D_REPORT_EVIDENCE_UNPINNED', 409);
        const evidence = this.object(pinned);
        if (evidence.objectVersionId !== file.objectVersionId || evidence.sha256 !== file.sha256 || evidence.version !== file.version
          || evidence.scanStatus !== 'CLEAN' || evidence.scannedAt !== file.scannedAt) this.fail('PROCESS_EIGHT_D_REPORT_VERSION_CONFLICT', 409);
      }
    }
    const uses = reportAttachmentUses(normalized);
    const attachments: ProcessEightDReportAttachmentDto[] = refs.map(file => {
      const isImage = ['image/png', 'image/jpeg'].includes(file.contentType);
      const canEmbed = isImage && file.sizeBytes <= REPORT_IMAGE_MAX_BYTES;
      return { id: file.id, originalName: file.originalName, contentType: file.contentType, sizeBytes: file.sizeBytes, sha256: file.sha256,
        objectVersionId: file.objectVersionId, version: file.version, uses: uses.get(file.id)!, rendering: canEmbed ? 'EMBEDDED' : 'LISTED',
        note: canEmbed ? 'PNG/JPEG 按章节嵌入；导出校验实际图像，原文件请使用正常授权下载'
          : isImage ? '图像超过 8 MiB 嵌入上限，未嵌入；请使用正常授权下载' : '非 PNG/JPEG 附件不合并；请使用正常授权下载' };
    });
    const historical = !!query.revisionId;
    const closed = !!result.record.report.closedRevisionId;
    const inReview = !result.revision && !closed && (isClosureReviewNode(result.record.node)
      || snapshot.approvalRounds?.some(round => round.status === 'PENDING' && round.contentVersion === snapshot.contentVersion));
    const status = result.revision ? historical ? 'HISTORICAL' : 'APPROVED' : closed ? 'CLOSED_SUPPLEMENT' : inReview ? 'IN_REVIEW' : 'DRAFT';
    const label = { HISTORICAL: '历史修订（固定快照，审批以本版记录为准）', APPROVED: '原批准版（固定快照）',
      CLOSED_SUPPLEMENT: '关闭后当前资料（非原批准版）', IN_REVIEW: '待审草稿（未批准）', DRAFT: '草稿（未批准）' }[status];
    return { result, refs, fingerprint: canonical({ snapshot: raw, revisionId: result.revision?.id ?? null, refs: [...refs].sort((a, b) => a.id.localeCompare(b.id)) }),
      report: { problemId, reportNumber: problem.reportNumber, view: historical ? 'HISTORICAL' : result.revision ? 'APPROVED' : 'CURRENT',
        revisionId: result.revision?.id ?? null, status, label, contentVersion: snapshot.contentVersion, rowVersion: snapshot.rowVersion,
        generatedAt: new Date().toISOString(), snapshot, attachments } };
  }

  private async images(selected: Selection): Promise<Map<string, Buffer>> {
    const images = new Map<string, Buffer>(); let total = 0; let pixels = 0;
    for (const file of selected.refs) {
      const attachment = selected.report.attachments.find(value => value.id === file.id)!;
      if (attachment.rendering !== 'EMBEDDED') continue;
      if (total + file.sizeBytes > REPORT_TOTAL_IMAGE_BYTES) this.fail('PROCESS_EIGHT_D_REPORT_IMAGE_LIMIT', 413);
      const chunks: Buffer[] = []; let received = 0;
      try {
        for await (const chunk of this.storage.readVersion(file.objectKey, file.objectVersionId, REPORT_IMAGE_MAX_BYTES)) {
          if (!(chunk instanceof Uint8Array) || received + chunk.byteLength > file.sizeBytes) this.fail('PROCESS_EIGHT_D_REPORT_OBJECT_INVALID', 409);
          received += chunk.byteLength; chunks.push(Buffer.from(chunk));
        }
      } catch (error) {
        if (error instanceof HttpException) throw error;
        if (error instanceof Error && (/^FILE_OBJECT_(?:INVALID|TRUNCATED|LIMIT|VERSION_REQUIRED)$/.test(error.message)
          || ['NoSuchKey', 'NoSuchVersion'].includes(error.name))) this.fail('PROCESS_EIGHT_D_REPORT_VERSION_CONFLICT', 409);
        this.fail('PROCESS_EIGHT_D_REPORT_STORAGE_UNAVAILABLE', 503);
      }
      const bytes = Buffer.concat(chunks);
      if (received !== file.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) this.fail('PROCESS_EIGHT_D_REPORT_OBJECT_INVALID', 409);
      try {
        const size = reportImageSize(bytes, file.contentType);
        pixels += size.width * size.height * attachment.uses.length;
      }
      catch (error) {
        if (error instanceof Error && error.message === 'PROCESS_EIGHT_D_REPORT_IMAGE_LIMIT') {
          attachment.rendering = 'LISTED'; attachment.note = '图像像素超过 8192 边长或 1600 万像素上限，未嵌入；请使用正常授权下载';
          continue;
        }
        this.fail('PROCESS_EIGHT_D_REPORT_IMAGE_INVALID', 422);
      }
      if (pixels > REPORT_TOTAL_IMAGE_PIXELS) this.fail('PROCESS_EIGHT_D_REPORT_IMAGE_LIMIT', 413);
      images.set(file.id, bytes); total += received;
    }
    return images;
  }

  private async finish(actor: ProcessEightDActor, problemId: string, query: ProcessEightDReportQueryDto, selected: Selection, traceId: string, format: 'READ' | 'PDF', content?: Buffer): Promise<void> {
    try { await this.transaction(async tx => {
      const current = await this.select(tx, actor, problemId, query, format === 'PDF' ? traceId : undefined);
      if (current.fingerprint !== selected.fingerprint) this.fail('PROCESS_EIGHT_D_REPORT_VERSION_CONFLICT', 409);
      await this.audit.record({ organizationId: selected.result.record.problem.organizationId, actorUserId: actor.id, action: this.code(`PROCESS_EIGHT_D_REPORT_${format}`),
        resourceType: this.auditResource, resourceId: problemId, outcome: 'SUCCESS', traceId,
        metadata: { resourceVersion: selected.report.rowVersion, status: selected.report.status,
          ...(content ? { sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') } : {}) } }, tx);
    }); } catch (error) {
      if (error instanceof HttpException && [401, 403, 409].includes(error.getStatus())) {
        await this.audit.record({ organizationId: selected.result.record.problem.organizationId, actorUserId: actor.id, action: this.code('PROCESS_EIGHT_D_REPORT_REJECTED'),
          resourceType: this.auditResource, resourceId: problemId, outcome: 'DENIED', traceId,
          metadata: { permissionCode: `${this.domain.permissionPrefix}:report`, reasonCode: this.code(error.getStatus() === 409
            ? 'PROCESS_EIGHT_D_REPORT_VERSION_CONFLICT' : 'PROCESS_EIGHT_D_REPORT_ACCESS_DENIED') } });
      }
      throw error;
    }
  }

  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: 'ReadCommitted' });
  }
}
