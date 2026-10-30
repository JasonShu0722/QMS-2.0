import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import type { FileEvidenceDto } from '../file-management/file.dto.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../file-management/object-storage.service.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { canonical } from '../workflow/workflow-runtime-policy.js';
import { documentFileIds } from '../process-quality/process-eight-d-document.js';
import { REPORT_IMAGE_MAX_BYTES, REPORT_TOTAL_IMAGE_BYTES, REPORT_TOTAL_IMAGE_PIXELS, renderProcessEightDPdf, reportImageSize } from '../process-quality/process-eight-d-pdf.js';
import { SupplierEightDService } from './supplier-eight-d.service.js';
import { supplierEightDReportModel, supplierReportFail as fail, supplierReportObject, type SupplierEightDReportCore, type SupplierEightDReportRead } from './supplier-eight-d-report.model.js';
import type { SupplierEightDActor } from './supplier-eight-d.types.js';
import type { SupplierEightDControlledReportDto, SupplierEightDReportQueryDto } from './supplier-eight-d-report.dto.js';
import { ServiceOperationReceiptService } from '../task-notification/service-operation-receipt.service.js';

type Reference = FileEvidenceDto & { objectKey: string; objectVersionId: string };
type Selection = { result: SupplierEightDReportRead; report: SupplierEightDControlledReportDto; refs: Reference[]; fingerprint: string };

@Injectable()
export class SupplierEightDReportService {
  constructor(private readonly prisma: PrismaService, @Inject(SupplierEightDService) private readonly core: SupplierEightDReportCore,
    private readonly files: FileLifecycleService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage, private readonly audit: AuditLogService,
    @Optional() private readonly operationReceipts?: ServiceOperationReceiptService) {}

  async read(actor: SupplierEightDActor, id: string, query: SupplierEightDReportQueryDto, traceId: string): Promise<SupplierEightDControlledReportDto> {
    this.validate(actor, id, query);
    const selected = await this.transaction(tx => this.select(tx, actor, id, query));
    await this.finish(actor, id, query, selected, traceId, 'READ');
    return selected.report;
  }

  async pdf(actor: SupplierEightDActor, id: string, query: SupplierEightDReportQueryDto, traceId: string): Promise<{ content: Buffer; contentType: 'application/pdf'; filename: string }> {
    this.validate(actor, id, query);
    const selected = await this.transaction(tx => this.select(tx, actor, id, query));
    const images = await this.images(selected);
    const executionId = randomUUID(), startedAt = new Date();
    const observe = async (status: 'STARTED' | 'SUCCEEDED' | 'FAILED') => {
      try { await this.operationReceipts?.recordPdf(selected.result.record.control.organizationId, 'supplier-quality', executionId, status, startedAt); }
      catch { /* Observation failures never change the business report result. */ }
    };
    await observe('STARTED');
    let content: Buffer;
    try { content = await renderProcessEightDPdf(selected.report, images, 'supplier-quality'); await observe('SUCCEEDED'); }
    catch (error) {
      await observe('FAILED');
      if (error instanceof Error && ['PROCESS_EIGHT_D_REPORT_IMAGE_LIMIT', 'PROCESS_EIGHT_D_REPORT_PDF_LIMIT'].includes(error.message)) fail(error.message.replace('PROCESS_EIGHT_D_REPORT_', ''), 413);
      fail('RENDER_FAILED', 422);
    }
    await this.finish(actor, id, query, selected, traceId, 'PDF', content);
    return { content, contentType: 'application/pdf', filename: `supplier-eight-d-${id}-v${selected.report.contentVersion}-${selected.report.view.toLowerCase()}.pdf` };
  }

  private validate(actor: SupplierEightDActor, id: string, query: SupplierEightDReportQueryDto) {
    if (!isUUID(id) || !query || typeof query !== 'object' || Array.isArray(query)
      || Object.keys(query).some(key => !['organizationId', 'revisionId', 'view'].includes(key))
      || query.organizationId !== undefined && !isUUID(query.organizationId)
      || query.revisionId !== undefined && !isUUID(query.revisionId)
      || query.view !== undefined && !['CURRENT', 'APPROVED'].includes(query.view)
      || query.revisionId !== undefined && query.view === 'CURRENT') fail('QUERY_INVALID', 400);
    if (!['INTERNAL', 'SUPPLIER'].includes(actor.accountType) || actor.scopeOrganizationId && actor.scopeOrganizationId !== actor.organizationId
      || query.organizationId !== undefined && query.organizationId !== actor.organizationId) fail('ACCESS_DENIED', 403);
  }

  private async select(tx: Prisma.TransactionClient, actor: SupplierEightDActor, id: string, query: SupplierEightDReportQueryDto, downloadTraceId?: string): Promise<Selection> {
    const result = await this.core.readReport(tx, actor, id, query.revisionId ?? (query.view === 'APPROVED' ? undefined : null));
    const supplier = actor.accountType === 'SUPPLIER';
    if (result.record.supplier.id !== id || (supplier ? result.record.supplier.supplierOrganizationId !== actor.organizationId
      || !result.record.supplier.releasedToSupplierAt : result.record.control.organizationId !== actor.organizationId)) fail('ACCESS_DENIED', 403);
    await assertWorkflowFeature(tx, actor, actor.organizationId, supplier ? 'supplier-quality:responses:read' : 'supplier-quality:issues:report');
    const report = supplierEightDReportModel(result, query, supplier), ids = documentFileIds(report.snapshot.document);
    const privateIds = result.privateSupplementFileIds;
    if (new Set(privateIds).size !== privateIds.length || privateIds.some(fileId => !ids.includes(fileId))
      || privateIds.length && (result.revision || !result.record.control.closedAt)) fail('SNAPSHOT_INVALID');
    const groups = [
      { resource: { resourceType: 'supplier-quality', resourceId: id }, fileIds: ids.filter(fileId => !privateIds.includes(fileId)) },
      { resource: { resourceType: 'supplier-eight-d-supplement', resourceId: id }, fileIds: privateIds },
    ].filter(group => group.fileIds.length);
    const refs = groups.length ? await this.files.readReportEvidence(tx, actor, groups, downloadTraceId) : [];
    if (refs.length !== ids.length || new Set(refs.map(file => file.id)).size !== ids.length) fail('EVIDENCE_DENIED', 403);
    const raw = supplierReportObject(result.snapshot);
    const evidence = raw.evidence;
    if (result.revision && (!Array.isArray(evidence) || evidence.length !== ids.length || new Set(evidence.map(value => supplierReportObject(value).id)).size !== ids.length)) fail('EVIDENCE_UNPINNED');
    const uses = new Map<string, string[]>(), add = (values: string[], purpose: string) => values.forEach(id => uses.set(id, [...uses.get(id) ?? [], purpose]));
    const document = report.snapshot.document;
    add(document.okFileIds, 'D2 OK'); add(document.ngFileIds, 'D2 NG'); add(document.analysisFileIds, 'D4 分析');
    document.temporaryMeasures.forEach(row => add(row.fileIds, `D3 临时措施 ${row.id}`));
    document.correctiveActions.forEach(row => { add(row.fileIds, `D5 / D6 措施 ${row.id}`); add(row.verificationFileIds, `D6 验证 ${row.id}`); });
    document.horizontalDeployment.forEach(row => add(row.fileIds, `D7 横展 ${row.id}`));
    for (const file of refs) {
      const group = groups.find(group => group.fileIds.includes(file.id));
      if (!group || file.resourceId !== id || file.resourceType !== group.resource.resourceType) fail('EVIDENCE_DENIED', 403);
      if (file.status !== 'AVAILABLE' || file.scanStatus !== 'CLEAN' || !file.downloadable || !file.scannedAt || !Number.isFinite(Date.parse(file.scannedAt))
        || !isUUID(file.objectKey, '4') || !file.objectVersionId || file.objectVersionId === 'null' || file.objectVersionId.length > 1024
        || !Number.isSafeInteger(file.version) || file.version < 1 || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > 25 * 1024 * 1024
        || !/^[0-9a-f]{64}$/.test(file.sha256)) fail('EVIDENCE_UNAVAILABLE');
      if (result.revision) {
        const pinned = (evidence as unknown[]).map(supplierReportObject).find(value => value.id === file.id);
        if (!pinned) fail('EVIDENCE_UNPINNED');
        if (['objectVersionId', 'sha256', 'version', 'scannedAt', 'scanStatus'].some(key => pinned[key] !== file[key as keyof Reference])) fail('VERSION_CONFLICT');
      }
      const image = ['image/png', 'image/jpeg'].includes(file.contentType), embed = image && file.sizeBytes <= REPORT_IMAGE_MAX_BYTES;
      report.attachments.push({ id: file.id, originalName: file.originalName, contentType: file.contentType, sizeBytes: file.sizeBytes,
        sha256: file.sha256, objectVersionId: file.objectVersionId, version: file.version, uses: uses.get(file.id)!, rendering: embed ? 'EMBEDDED' : 'LISTED',
        note: embed ? 'PNG/JPEG 按章节嵌入，下载原文件仍需授权' : image ? '图像超过 8 MiB，未嵌入；下载原文件仍需授权' : '非 PNG/JPEG 附件仅列示，不合并原文件' });
    }
    return { result, report, refs, fingerprint: canonical({ snapshot: raw, revisionId: result.revision?.id ?? null,
      versionFingerprint: result.versionFingerprint, record: result.record, privateIds, refs: [...refs].sort((a, b) => a.id.localeCompare(b.id)) }) };
  }

  private async images(selected: Selection): Promise<Map<string, Buffer>> {
    const images = new Map<string, Buffer>(); let total = 0, pixels = 0;
    for (const file of selected.refs) {
      const attachment = selected.report.attachments.find(value => value.id === file.id)!;
      if (attachment.rendering !== 'EMBEDDED') continue;
      if (total + file.sizeBytes > REPORT_TOTAL_IMAGE_BYTES) fail('IMAGE_LIMIT', 413);
      const chunks: Buffer[] = []; let received = 0;
      try {
        for await (const chunk of this.storage.readVersion(file.objectKey, file.objectVersionId, REPORT_IMAGE_MAX_BYTES)) {
          if (!(chunk instanceof Uint8Array) || received + chunk.byteLength > file.sizeBytes) fail('OBJECT_INVALID');
          received += chunk.byteLength; chunks.push(Buffer.from(chunk));
        }
      } catch (error) {
        if (error instanceof HttpException) throw error;
        if (error instanceof Error && (/^FILE_OBJECT_(INVALID|TRUNCATED|LIMIT|VERSION_REQUIRED)$/.test(error.message) || ['NoSuchKey', 'NoSuchVersion'].includes(error.name))) fail('VERSION_CONFLICT');
        fail('STORAGE_UNAVAILABLE', 503);
      }
      const bytes = Buffer.concat(chunks);
      if (received !== file.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) fail('OBJECT_INVALID');
      total += received;
      try {
        const size = reportImageSize(bytes, file.contentType); pixels += size.width * size.height * attachment.uses.length;
      } catch (error) {
        if (error instanceof Error && error.message === 'PROCESS_EIGHT_D_REPORT_IMAGE_LIMIT') {
          attachment.rendering = 'LISTED'; attachment.note = '图像超过 8192 边长或 1600 万像素，未嵌入；下载原文件仍需授权'; continue;
        }
        fail('IMAGE_INVALID', 422);
      }
      if (pixels > REPORT_TOTAL_IMAGE_PIXELS) fail('IMAGE_LIMIT', 413);
      images.set(file.id, bytes);
    }
    return images;
  }

  private async finish(actor: SupplierEightDActor, id: string, query: SupplierEightDReportQueryDto, selected: Selection, traceId: string, format: 'READ' | 'PDF', content?: Buffer) {
    try {
      await this.transaction(async tx => {
        const current = await this.select(tx, actor, id, query, format === 'PDF' ? traceId : undefined);
        if (current.fingerprint !== selected.fingerprint) fail('VERSION_CONFLICT');
        await this.audit.record({ organizationId: selected.result.record.control.organizationId, actorUserId: actor.id,
          action: `SUPPLIER_EIGHT_D_REPORT_${format}`, resourceType: 'SupplierEightDReport', resourceId: id, outcome: 'SUCCESS', traceId,
          metadata: { resourceVersion: selected.report.rowVersion, status: selected.report.status,
            ...(content ? { sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') } : {}) } }, tx);
      });
    } catch (error) {
      if (error instanceof HttpException && [401, 403, 404, 409].includes(error.getStatus())) {
        await this.audit.record({ organizationId: selected.result.record.control.organizationId, actorUserId: actor.id,
          action: 'SUPPLIER_EIGHT_D_REPORT_REJECTED', resourceType: 'SupplierEightDReport', resourceId: id, outcome: 'DENIED', traceId,
          metadata: { permissionCode: actor.accountType === 'SUPPLIER' ? 'supplier-quality:responses:read' : 'supplier-quality:issues:report',
            reasonCode: `SUPPLIER_EIGHT_D_REPORT_${error.getStatus() === 409 ? 'VERSION_CONFLICT' : 'ACCESS_DENIED'}` } });
      }
      throw error;
    }
  }

  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: 'ReadCommitted' });
  }
}
