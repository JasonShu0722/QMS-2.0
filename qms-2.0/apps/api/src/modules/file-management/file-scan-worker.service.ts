import { Inject, Injectable, Optional } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma, type FileObject, type OutboxEvent } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileVerificationService, type FileVerification } from './file-verification.service.js';

export const FILE_SCAN_LEASE_MS = 120000;
export const FILE_SCAN_CLOCK = Symbol('FILE_SCAN_CLOCK');

@Injectable()
export class FileScanWorkerService {
  constructor(private readonly prisma: PrismaService, private readonly verifier: FileVerificationService, private readonly audit: AuditLogService,
    @Optional() @Inject(FILE_SCAN_CLOCK) private readonly now: () => Date = () => new Date()) {}

  async processDue(limit = 25) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('FILE_SCAN_LIMIT_INVALID');
    const counts = { processed: 0, retried: 0, failed: 0 };
    for (let index = 0; index < limit; index += 1) {
      const now = this.now();
      const [event] = await this.prisma.$queryRaw<OutboxEvent[]>(Prisma.sql`
        UPDATE outbox_events SET status = 'PROCESSING', processing_at = ${now}
        WHERE id IN (SELECT id FROM outbox_events WHERE event_type = 'FILE_SCAN_REQUESTED'
          AND ((status = 'PENDING' AND available_at <= ${now}) OR (status = 'PROCESSING' AND processing_at <= ${new Date(now.getTime() - FILE_SCAN_LEASE_MS)}))
          ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, event_key AS "eventKey", aggregate_type AS "aggregateType", aggregate_id AS "aggregateId", event_type AS "eventType",
          payload, status, attempts, available_at AS "availableAt", processing_at AS "processingAt", created_at AS "createdAt", processed_at AS "processedAt", last_error AS "lastError"`);
      if (!event) break;
      try {
        const payload = this.payload(event);
        const file = await this.prisma.fileObject.findUnique({ where: { id: payload.fileId } });
        if (!file || file.organizationId !== payload.organizationId || !file.uploadCompletedAt || !file.objectVersionId || payload.fileVersion > file.version) throw new Error('FILE_SCAN_EVENT_INVALID');
        const current = file.status === 'QUARANTINED' && file.version === payload.fileVersion && ['PENDING', 'ERROR'].includes(file.scanStatus);
        const verification = current ? await this.verifier.verify(file) : null;
        if (await this.finalize(event, file, verification)) counts.processed += 1;
      } catch (error) {
        const outcome = await this.fail(event, error);
        if (outcome) counts[outcome] += 1;
      }
    }
    return counts;
  }

  async expireUploads(limit = 100): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM file_objects WHERE status = 'QUARANTINED' AND scan_status = 'WAITING_UPLOAD'
        AND object_version_id IS NULL AND upload_expires_at <= ${this.now()} ORDER BY upload_expires_at LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      for (const row of rows) {
        const file = await tx.fileObject.update({ where: { id: row.id }, data: { scanStatus: 'EXPIRED', scanReason: 'FILE_UPLOAD_EXPIRED', version: { increment: 1 } } });
        await this.audit.record({ organizationId: file.organizationId, action: 'ATTACHMENT_UPLOAD_EXPIRED', resourceType: 'FileObject', resourceId: file.id, outcome: 'SUCCESS', traceId: `file-expire:${file.id}`, metadata: { resourceVersion: file.version } }, tx);
      }
      return rows.length;
    }, { isolationLevel: 'ReadCommitted' });
  }

  private payload(event: OutboxEvent): { fileId: string; organizationId: string; fileVersion: number } {
    const payload = event.payload as Record<string, unknown> | null;
    if (!payload || typeof payload !== 'object' || payload.schemaVersion !== 1 || !isUUID(String(payload.fileId)) || !isUUID(String(payload.organizationId))
      || !Number.isInteger(payload.fileVersion) || Number(payload.fileVersion) < 2 || event.aggregateType !== 'FileObject' || event.aggregateId !== payload.fileId
      || event.eventKey !== `file-scan:${payload.fileId}:${payload.fileVersion}`) throw new Error('FILE_SCAN_EVENT_INVALID');
    return { fileId: String(payload.fileId), organizationId: String(payload.organizationId), fileVersion: Number(payload.fileVersion) };
  }

  private async lease(tx: Prisma.TransactionClient, event: OutboxEvent) {
    await tx.$queryRaw`SELECT id FROM outbox_events WHERE id = ${event.id}::uuid FOR UPDATE`;
    const current = await tx.outboxEvent.findUnique({ where: { id: event.id } });
    return current?.status === 'PROCESSING' && current.processingAt?.getTime() === event.processingAt?.getTime()
      && !!event.processingAt && event.processingAt.getTime() > this.now().getTime() - FILE_SCAN_LEASE_MS;
  }

  private async finalize(event: OutboxEvent, snapshot: FileObject, verification: FileVerification | null): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      if (!await this.lease(tx, event)) return false;
      await tx.$queryRaw`SELECT id FROM file_objects WHERE id = ${snapshot.id}::uuid FOR UPDATE`;
      const current = await tx.fileObject.findUnique({ where: { id: snapshot.id } });
      if (verification && current?.status === 'QUARANTINED' && current.version === snapshot.version && current.objectVersionId === snapshot.objectVersionId) {
        const file = await tx.fileObject.update({ where: { id: current.id }, data: { status: verification.clean ? 'AVAILABLE' : 'QUARANTINED',
          verifiedSha256: verification.sha256, verifiedSizeBytes: verification.sizeBytes, verifiedContentType: verification.contentType,
          scannedAt: this.now(), scannerEngine: verification.engine, scanReason: verification.reason, scanStatus: verification.clean ? 'CLEAN' : 'REJECTED', version: { increment: 1 } } });
        await this.audit.record({ organizationId: file.organizationId, action: verification.clean ? 'ATTACHMENT_SCAN_CLEAN' : 'ATTACHMENT_SCAN_REJECTED', resourceType: 'FileObject', resourceId: file.id,
          outcome: verification.clean ? 'SUCCESS' : 'DENIED', traceId: event.eventKey, metadata: { reasonCode: verification.reason, resourceVersion: file.version, sha256: verification.sha256 } }, tx);
      }
      if (event.processingAt!.getTime() <= this.now().getTime() - FILE_SCAN_LEASE_MS) throw new Error('FILE_SCAN_LEASE_EXPIRED');
      await tx.outboxEvent.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: this.now(), processingAt: null, lastError: null } });
      return true;
    }, { isolationLevel: 'ReadCommitted' });
  }

  private async fail(event: OutboxEvent, error: unknown): Promise<'failed' | 'retried' | null> {
    const allowed = new Set(['FILE_SCANNER_CONFIGURATION_REQUIRED', 'FILE_SCANNER_TIMEOUT', 'FILE_SCANNER_UNAVAILABLE', 'FILE_SCANNER_SCAN_FAILED', 'FILE_SCANNER_PROTOCOL_INVALID',
      'FILE_SCANNER_RESPONSE_INCOMPLETE', 'FILE_SCANNER_RESPONSE_LIMIT', 'FILE_SCANNER_TRANSMISSION_FAILED', 'FILE_SCAN_EVENT_INVALID', 'FILE_SCAN_SIZE_INVALID', 'FILE_OBJECT_VERSION_REQUIRED',
      'FILE_TYPE_DETECTION_TIMEOUT', 'FILE_TYPE_DETECTION_FAILED', 'FILE_OBJECT_INVALID', 'FILE_OBJECT_TIMEOUT', 'FILE_OBJECT_LIMIT', 'FILE_OBJECT_TRUNCATED']);
    const reason = error instanceof Error && allowed.has(error.message) ? error.message : 'FILE_SCAN_UNAVAILABLE';
    return this.prisma.$transaction(async (tx) => {
      if (!await this.lease(tx, event)) return null;
      const failed = event.attempts + 1 >= 5;
      let payload: ReturnType<FileScanWorkerService['payload']> | undefined;
      try { payload = this.payload(event); } catch {}
      if (payload) {
        await tx.$queryRaw`SELECT id FROM file_objects WHERE id = ${payload.fileId}::uuid FOR UPDATE`;
        if (!await this.lease(tx, event)) return null;
        const file = await tx.fileObject.findUnique({ where: { id: payload.fileId } });
        if (file && file.organizationId === payload.organizationId && file.version === payload.fileVersion && file.uploadCompletedAt && file.objectVersionId
          && file.status === 'QUARANTINED' && ['PENDING', 'ERROR'].includes(file.scanStatus)) {
          await tx.fileObject.update({ where: { id: file.id }, data: { scanStatus: 'ERROR', scanReason: reason } });
          await this.audit.record({ organizationId: file.organizationId, action: 'ATTACHMENT_SCAN_FAILED', resourceType: 'FileObject', resourceId: file.id, outcome: 'FAILURE', traceId: event.eventKey, metadata: { reasonCode: reason } }, tx);
        }
      }
      if (event.processingAt!.getTime() <= this.now().getTime() - FILE_SCAN_LEASE_MS) throw new Error('FILE_SCAN_LEASE_EXPIRED');
      await tx.outboxEvent.update({ where: { id: event.id }, data: { status: failed ? 'FAILED' : 'PENDING', attempts: { increment: 1 }, processingAt: null,
        availableAt: new Date(this.now().getTime() + 1000 * 2 ** event.attempts), lastError: reason } });
      return failed ? 'failed' : 'retried';
    }, { isolationLevel: 'ReadCommitted' }).catch((failure: unknown) => {
      if (failure instanceof Error && failure.message === 'FILE_SCAN_LEASE_EXPIRED') return null;
      throw failure;
    });
  }
}
