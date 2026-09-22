import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { FileObject, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { canonical, workflowError } from '../workflow/workflow-runtime-policy.js';
import { FilePolicyService } from './file-policy.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.service.js';
import { FileResourceAccess, type FileActor, type FileResourceAction, type FileResourceGrant, type FileResourceRef } from './file-resource-access.js';
import { FileDto, FileDownloadDto, FileEvidenceDto, FileUploadDto, InitializeFileUploadDto } from './file.dto.js';

const UPLOAD_LIFETIME_MS = 15 * 60_000;
const RETENTION_MS = 7 * 24 * 3600_000;

export function fileDto(file: FileObject): FileDto {
  return { id: file.id, resourceType: file.resourceType!, resourceId: file.resourceId!, originalName: file.originalName,
    contentType: file.contentType, sizeBytes: Number(file.sizeBytes), sha256: file.sha256, status: file.status,
    scanStatus: file.scanStatus, scanReason: file.scanReason, version: file.version, uploadExpiresAt: file.uploadExpiresAt.toISOString(),
    scannedAt: file.scannedAt?.toISOString() ?? null, deletedAt: file.deletedAt?.toISOString() ?? null, retainUntil: file.retainUntil.toISOString() };
}

@Injectable()
export class FileLifecycleService {
  constructor(private readonly prisma: PrismaService, private readonly policy: FilePolicyService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage, private readonly audit: AuditLogService,
    private readonly resources: FileResourceAccess) {}

  async initializeUpload(actor: FileActor, input: InitializeFileUploadDto, key: string, traceId: string): Promise<FileUploadDto> {
    const receiptKey = this.receiptKey('upload', key);
    const digest = createHash('sha256').update(canonical(input)).digest('hex');
    const file = await this.prisma.$transaction(async (tx) => {
      await this.lockReceipt(tx, actor, receiptKey);
      const grant = await this.access(tx, actor, input, 'upload');
      this.validateInput(input);
      const receipt = await tx.fileUploadReceipt.findUnique({ where: { actorUserId_key: { actorUserId: actor.id, key: receiptKey } }, include: { file: true } });
      if (receipt) {
        if (receipt.requestDigest !== digest) workflowError('IDEMPOTENCY_REPLAY', 409);
        const existing = receipt.file;
        if (existing.organizationId !== grant.organizationId || existing.resourceVersion !== grant.version) workflowError('CONCURRENCY_CONFLICT', 409);
        this.assertWaiting(existing);
        return existing;
      }
      const reservation = await tx.fileObject.aggregate({ where: { organizationId: grant.organizationId, resourceType: input.resourceType, resourceId: input.resourceId,
        status: { not: 'DELETED' }, OR: [{ objectVersionId: { not: null } }, { scanStatus: 'WAITING_UPLOAD', uploadExpiresAt: { gt: new Date() } }] }, _count: true, _sum: { sizeBytes: true } });
      if (reservation._count >= this.policy.maxFiles || Number(reservation._sum.sizeBytes ?? 0) + input.sizeBytes > this.policy.maxBytes) workflowError('FILE_QUOTA_EXCEEDED', 409);
      const created = await tx.fileObject.create({ data: { organizationId: grant.organizationId, resourceType: input.resourceType, resourceId: input.resourceId,
        resourceVersion: grant.version, uploadedById: actor.id, objectKey: randomUUID(), originalName: input.originalName,
        contentType: input.contentType, sizeBytes: input.sizeBytes, sha256: input.sha256, status: 'QUARANTINED',
        uploadExpiresAt: new Date(Date.now() + UPLOAD_LIFETIME_MS), retainUntil: new Date(Date.now() + RETENTION_MS) } });
      await tx.fileUploadReceipt.create({ data: { actorUserId: actor.id, key: receiptKey, requestDigest: digest, fileId: created.id } });
      await this.record(tx, actor, created, 'ATTACHMENT_UPLOAD_INITIALIZED', traceId);
      return created;
    }, { isolationLevel: 'ReadCommitted' });
    const upload = await this.storage.createUploadUrl(file.objectKey, file.contentType);
    if (upload.objectKey !== file.objectKey) throw new Error('UPLOAD_URL_OBJECT_KEY_MISMATCH');
    return { file: fileDto(file), uploadUrl: upload.url, headers: upload.headers, urlExpiresAt: new Date(Date.now() + 60000).toISOString() };
  }

  async complete(actor: FileActor, id: string, expectedVersion: number, key: string, traceId: string): Promise<FileDto> {
    this.assertVersion(expectedVersion);
    const receiptKey = this.receiptKey('complete', key);
    const digest = createHash('sha256').update(canonical({ id, expectedVersion })).digest('hex');
    const prepare = async (tx: Prisma.TransactionClient) => {
      await this.lockReceipt(tx, actor, receiptKey);
      const { file, grant } = await this.authorizedFile(tx, actor, id, 'complete');
      const receipt = await tx.fileUploadReceipt.findUnique({ where: { actorUserId_key: { actorUserId: actor.id, key: receiptKey } } });
      if (receipt) {
        if (receipt.requestDigest !== digest || receipt.fileId !== id) workflowError('IDEMPOTENCY_REPLAY', 409);
        if (file.status === 'DELETED') workflowError('FILE_NOT_AVAILABLE', 409);
        return { file, replay: true };
      }
      if (file.version !== expectedVersion || file.resourceVersion !== grant.version) workflowError('CONCURRENCY_CONFLICT', 409);
      if (file.uploadedById !== actor.id) workflowError('FILE_RESOURCE_DENIED', 403);
      this.assertWaiting(file);
      return { file, replay: false };
    };
    const initial = await this.prisma.$transaction(prepare, { isolationLevel: 'ReadCommitted' });
    if (initial.replay) return fileDto(initial.file);
    let object: Awaited<ReturnType<ObjectStorage['head']>>;
    try { object = await this.storage.head(initial.file.objectKey); }
    catch { workflowError('FILE_OBJECT_UNAVAILABLE', 409); }
    if (object.sizeBytes !== Number(initial.file.sizeBytes) || object.contentType !== initial.file.contentType) workflowError('FILE_CONTENT_MISMATCH', 409);
    return this.prisma.$transaction(async (tx) => {
      const current = await prepare(tx);
      if (current.replay) return fileDto(current.file);
      const retainUntil = new Date(Math.max(current.file.retainUntil.getTime(), Date.now() + RETENTION_MS, object.retainUntil?.getTime() ?? 0));
      const file = await tx.fileObject.update({ where: { id }, data: { objectVersionId: object.versionId, uploadCompletedAt: new Date(), scanStatus: 'PENDING', retainUntil, version: { increment: 1 } } });
      await tx.fileUploadReceipt.create({ data: { actorUserId: actor.id, key: receiptKey, requestDigest: digest, fileId: id } });
      await tx.outboxEvent.create({ data: { eventKey: `file-scan:${id}:${file.version}`, aggregateType: 'FileObject', aggregateId: id, eventType: 'FILE_SCAN_REQUESTED',
        payload: { schemaVersion: 1, organizationId: file.organizationId, fileId: id, fileVersion: file.version } } });
      await this.record(tx, actor, file, 'ATTACHMENT_UPLOAD_COMPLETED', traceId);
      return fileDto(file);
    }, { isolationLevel: 'ReadCommitted' });
  }

  async get(actor: FileActor, id: string): Promise<FileDto> {
    return this.prisma.$transaction(async (tx) => fileDto((await this.authorizedFile(tx, actor, id, 'read')).file), { isolationLevel: 'ReadCommitted' });
  }

  async readEvidence(tx: Prisma.TransactionClient, actor: FileActor, groups: { resource: FileResourceRef; fileIds: string[] }[]): Promise<FileEvidenceDto[]> {
    const ids = groups.flatMap((group) => group.fileIds);
    const resourceKey = (resource: FileResourceRef) => `${resource.resourceType}:${resource.resourceId}`;
    if (groups.length > 100 || ids.length > 100 || new Set(ids).size !== ids.length || new Set(groups.map((group) => resourceKey(group.resource))).size !== groups.length) workflowError('FILE_UPLOAD_INVALID', 400);
    const [isolation] = await tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`;
    if (isolation?.transaction_isolation !== 'read committed') workflowError('WORKFLOW_TRANSACTION_ISOLATION_UNSUPPORTED', 409);
    const ordered = [...groups].sort((first, second) => resourceKey(first.resource).localeCompare(resourceKey(second.resource)));
    const grants = new Map<string, FileResourceGrant>();
    for (const group of ordered) grants.set(resourceKey(group.resource), await this.resources.authorizeAndLock(tx, actor, group.resource, 'read'));
    const candidates = await tx.fileObject.findMany({ where: { id: { in: ids } } });
    if (candidates.length !== ids.length) workflowError('FILE_RESOURCE_DENIED', 403);
    for (const group of ordered) {
      const grant = grants.get(resourceKey(group.resource))!;
      if (candidates.filter((file) => group.fileIds.includes(file.id)).some((file) => file.organizationId !== grant.organizationId || file.resourceType !== group.resource.resourceType || file.resourceId !== group.resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    }
    for (const id of [...ids].sort()) await tx.$queryRaw`SELECT id FROM file_objects WHERE id = ${id}::uuid FOR UPDATE`;
    const authentication = await assertActiveAuthentication(tx, actor);
    if (authentication.user.organizationId !== actor.organizationId || authentication.user.accountType !== actor.accountType) workflowError('AUTH_SESSION_REQUIRED', 401);
    for (const group of ordered) {
      const current = await this.resources.authorizeAndLock(tx, actor, group.resource, 'read');
      const initial = grants.get(resourceKey(group.resource))!;
      if (current.organizationId !== initial.organizationId || current.version !== initial.version) workflowError('CONCURRENCY_CONFLICT', 409);
    }
    const files = await tx.fileObject.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    for (const file of files) {
      const group = ordered.find((entry) => entry.fileIds.includes(file.id))!;
      if (file.organizationId !== grants.get(resourceKey(group.resource))!.organizationId || file.resourceType !== group.resource.resourceType || file.resourceId !== group.resource.resourceId) workflowError('FILE_RESOURCE_DENIED', 403);
    }
    return files.map((file) => ({ ...fileDto(file), downloadable: this.isAvailable(file) }));
  }

  async download(actor: FileActor, id: string, traceId: string): Promise<FileDownloadDto> {
    const file = await this.prisma.$transaction(async (tx) => {
      const current = (await this.authorizedFile(tx, actor, id, 'read')).file;
      this.assertAvailable(current);
      await this.record(tx, actor, current, 'ATTACHMENT_DOWNLOAD_AUTHORIZED', traceId);
      return current;
    }, { isolationLevel: 'ReadCommitted' });
    return { url: await this.storage.createDownloadUrl(file.objectKey, file.objectVersionId!, file.originalName), expiresAt: new Date(Date.now() + 60000).toISOString() };
  }

  async deleteLogically(actor: FileActor, id: string, expectedVersion: number, traceId: string): Promise<FileDto> {
    this.assertVersion(expectedVersion);
    return this.prisma.$transaction(async (tx) => {
      const { file } = await this.authorizedFile(tx, actor, id, 'delete');
      if (file.version !== expectedVersion) workflowError('CONCURRENCY_CONFLICT', 409);
      if (file.status === 'DELETED') workflowError('FILE_NOT_AVAILABLE', 409);
      const deleted = await tx.fileObject.update({ where: { id }, data: { status: 'DELETED', deletedAt: new Date(), deletedById: actor.id, version: { increment: 1 } } });
      await this.record(tx, actor, deleted, 'ATTACHMENT_DELETED', traceId);
      return fileDto(deleted);
    }, { isolationLevel: 'ReadCommitted' });
  }

  async assertAttachable(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, fileIds: string[]): Promise<FileDto[]> {
    if (fileIds.length > this.policy.maxFiles || new Set(fileIds).size !== fileIds.length) workflowError('FILE_UPLOAD_INVALID', 400);
    const [isolation] = await tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`;
    if (isolation?.transaction_isolation !== 'read committed') workflowError('WORKFLOW_TRANSACTION_ISOLATION_UNSUPPORTED', 409);
    const grant = await this.access(tx, actor, resource, 'attach', fileIds);
    const result: FileDto[] = [];
    for (const id of [...fileIds].sort()) {
      const file = await tx.fileObject.findUniqueOrThrow({ where: { id } });
      if (file.organizationId !== grant.organizationId || file.resourceType !== resource.resourceType || file.resourceId !== resource.resourceId) workflowError('FILE_RESOURCE_DENIED', 403);
      this.assertAvailable(file);
      result.push(fileDto(file));
    }
    return result;
  }

  private async access(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction, fileIds: string[] = []): Promise<FileResourceGrant> {
    const initial = await this.resources.authorizeAndLock(tx, actor, resource, action);
    const scope = `file-resource:${resource.resourceType}:${resource.resourceId}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))::text`;
    const candidates = await tx.fileObject.findMany({ where: { id: { in: fileIds } }, select: { organizationId: true, resourceType: true, resourceId: true } });
    if (candidates.length !== fileIds.length || candidates.some((file) => file.organizationId !== initial.organizationId || file.resourceType !== resource.resourceType || file.resourceId !== resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    for (const fileId of [...fileIds].sort()) await tx.$queryRaw`SELECT id FROM file_objects WHERE id = ${fileId}::uuid FOR UPDATE`;
    const authentication = await assertActiveAuthentication(tx, actor);
    if (authentication.user.organizationId !== actor.organizationId || authentication.user.accountType !== actor.accountType) workflowError('AUTH_SESSION_REQUIRED', 401);
    const current = await this.resources.authorizeAndLock(tx, actor, resource, action);
    if (initial.organizationId !== current.organizationId || initial.version !== current.version) workflowError('CONCURRENCY_CONFLICT', 409);
    return current;
  }

  private async authorizedFile(tx: Prisma.TransactionClient, actor: FileActor, id: string, action: FileResourceAction) {
    const candidate = await tx.fileObject.findUnique({ where: { id } });
    if (!candidate || !candidate.resourceType || !candidate.resourceId) workflowError('FILE_NOT_FOUND', 404);
    const grant = await this.access(tx, actor, { resourceType: candidate.resourceType, resourceId: candidate.resourceId }, action, [id]);
    const file = await tx.fileObject.findUniqueOrThrow({ where: { id } });
    if (file.organizationId !== grant.organizationId || file.resourceId !== candidate.resourceId || file.resourceType !== candidate.resourceType) workflowError('FILE_RESOURCE_DENIED', 403);
    return { file, grant };
  }

  private assertWaiting(file: FileObject) {
    if (file.uploadExpiresAt.getTime() <= Date.now() || file.scanStatus === 'EXPIRED') workflowError('FILE_UPLOAD_EXPIRED', 409);
    if (file.status !== 'QUARANTINED' || file.scanStatus !== 'WAITING_UPLOAD' || file.objectVersionId) workflowError('FILE_NOT_AVAILABLE', 409);
  }

  private assertAvailable(file: FileObject) {
    if (!this.isAvailable(file)) workflowError('FILE_NOT_AVAILABLE', 409);
  }

  private isAvailable(file: FileObject): boolean {
    return file.status === 'AVAILABLE' && file.scanStatus === 'CLEAN' && !!file.objectVersionId && !!file.scannedAt && !!file.scannerEngine
      && file.verifiedSha256 === file.sha256 && file.verifiedContentType === file.contentType && file.verifiedSizeBytes === file.sizeBytes;
  }

  private validateInput(input: InitializeFileUploadDto) {
    if (!/^[0-9a-f]{64}$/.test(input.sha256) || !input.originalName?.trim() || input.originalName.length > 255 || /[\x00-\x1f\x7f\\/]/.test(input.originalName)) workflowError('FILE_UPLOAD_INVALID', 400);
    this.policy.assertOne(input);
  }

  private assertVersion(version: number) {
    if (!Number.isSafeInteger(version) || version < 1) workflowError('FILE_UPLOAD_INVALID', 400);
  }

  private receiptKey(action: string, key: string) {
    if (!/^[A-Za-z0-9._:-]{8,119}$/.test(key ?? '')) workflowError('IDEMPOTENCY_KEY_REQUIRED', 400);
    return `${action}:${key}`;
  }

  private async lockReceipt(tx: Prisma.TransactionClient, actor: FileActor, key: string) {
    const scope = `file-receipt:${actor.id}:${key}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))::text`;
  }

  private record(tx: Prisma.TransactionClient, actor: FileActor, file: FileObject, action: string, traceId: string) {
    return this.audit.record({ organizationId: file.organizationId, actorUserId: actor.id, action, resourceType: 'FileObject', resourceId: file.id, outcome: 'SUCCESS', traceId,
      metadata: { fileId: file.id, contentType: file.contentType, sizeBytes: Number(file.sizeBytes), resourceVersion: file.version, status: file.status } }, tx);
  }
}
