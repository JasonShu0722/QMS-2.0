import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { adminError } from '../../common/security/admin-mutation.service.js';
import { isSecurityConcurrencyConflict } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { OutboxService } from '../task-notification/outbox.service.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import { featurePredicate } from '../workflow/workflow-access-policy.js';
import { canonical } from '../workflow/workflow-runtime-policy.js';
import { SupplierEightDService } from './supplier-eight-d.service.js';
import type { SupplierEightDActor, SupplierEightDDisclosureContext } from './supplier-eight-d.types.js';
import type { SupplierDisclosurePreviewDto, SupplierDisclosurePreviewResultDto, SupplierDisclosureReleaseDto, SupplierDisclosureReleaseResultDto } from './supplier-eight-d-disclosure.dto.js';

const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const PREVIEW_LIFETIME_MS = 15 * 60_000;
type Preview = { id: string; rowVersion: number; contentVersion: number; instanceVersion: number;
  targetSupplierOrganizationId: string; snapshot: Prisma.JsonValue; digest: string; expiresAt: Date; consumedAt: Date | null };

@Injectable()
export class SupplierEightDDisclosureService {
  constructor(private readonly prisma: PrismaService, private readonly core: SupplierEightDService,
    private readonly audit: AuditLogService, private readonly outbox: OutboxService, private readonly files: FileLifecycleService) {}

  preview(actor: SupplierEightDActor, id: string, input: SupplierDisclosurePreviewDto, traceId: string): Promise<SupplierDisclosurePreviewResultDto> {
    this.selection(input.selectedFileIds);
    return this.transaction(async tx => {
      const context = await this.core.disclosureContext(tx, actor, id);
      if (context.releasedToSupplierAt || context.rowVersion !== input.expectedRowVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const target = await this.target(tx, context);
      const attachments = await this.attachments(tx, actor, id, input.selectedFileIds);
      const snapshot = { publicFacts: context.publicFacts, supplierName: target.displayName,
        supplierOrganizationId: context.supplierOrganizationId!, profileVersion: target.version, selectedFileIds: input.selectedFileIds, attachments };
      const now = new Date(), expiresAt = new Date(now.getTime() + PREVIEW_LIFETIME_MS), previewToken = randomUUID();
      await tx.$executeRaw`INSERT INTO supplier_eight_d_disclosure_previews
        (id, organization_id, supplier_problem_id, actor_user_id, target_supplier_organization_id, row_version, content_version,
          instance_version, snapshot, digest, created_at, expires_at)
        VALUES (${previewToken}::uuid, ${context.organizationId}::uuid, ${id}::uuid, ${actor.id}::uuid,
          ${context.supplierOrganizationId}::uuid, ${context.rowVersion}, ${context.contentVersion}, ${context.instanceVersion},
          ${JSON.stringify(snapshot)}::jsonb, ${digest(snapshot)}, ${now}, ${expiresAt})`;
      await this.audit.record({ organizationId: context.organizationId, actorUserId: actor.id,
        action: 'SUPPLIER_EIGHT_D_DISCLOSURE_PREVIEWED', resourceType: 'SupplierQualityProblem', resourceId: id, outcome: 'SUCCESS', traceId,
        metadata: { resourceVersion: context.rowVersion } }, tx);
      return { previewToken, supplierOrganizationId: context.supplierOrganizationId!, supplierName: target.displayName,
        rowVersion: context.rowVersion, expiresAt: expiresAt.toISOString(), publicFacts: context.publicFacts,
        selectedFileIds: input.selectedFileIds, attachments: attachments.map(({ objectVersionId: _version, ...file }) => file),
        warnings: ['仅释放预览列示的信息；请核查自由文本和附件中的敏感内容。释放不表示对方已经收到或签收。'] };
    });
  }

  release(actor: SupplierEightDActor, id: string, input: SupplierDisclosureReleaseDto, key: string, traceId: string): Promise<SupplierDisclosureReleaseResultDto> {
    this.selection(input.selectedFileIds);
    if (input.confirmed !== true || !isUUID(input.previewToken) || typeof key !== 'string' || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) {
      adminError('SUPPLIER_INPUT_INVALID', 400);
    }
    const requestDigest = digest({ action: 'RELEASE', id, input });
    return this.transaction(async tx => {
      const scope = await this.core.disclosureContext(tx, actor, id, 'REPLAY');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-eight-d:${scope.organizationId}:${actor.id}:${key}`}, 0))::text`;
      const [receipt] = await tx.$queryRaw<{ supplierProblemId: string; action: string; digest: string; response: Prisma.JsonValue }[]>`
        SELECT supplier_problem_id AS "supplierProblemId", action, digest, response FROM supplier_eight_d_receipts
        WHERE organization_id = ${scope.organizationId}::uuid AND actor_user_id = ${actor.id}::uuid AND key = ${key}`;
      if (receipt) {
        if (receipt.supplierProblemId !== id || receipt.action !== 'RELEASE' || receipt.digest !== requestDigest) adminError('IDEMPOTENCY_REPLAY', 409);
        return receipt.response as unknown as SupplierDisclosureReleaseResultDto;
      }
      let context = await this.core.disclosureContext(tx, actor, id);
      if (context.releasedToSupplierAt || context.rowVersion !== input.expectedRowVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const [preview] = await tx.$queryRaw<Preview[]>`SELECT id, row_version AS "rowVersion", content_version AS "contentVersion",
        instance_version AS "instanceVersion", target_supplier_organization_id AS "targetSupplierOrganizationId",
        snapshot, digest, expires_at AS "expiresAt", consumed_at AS "consumedAt"
        FROM supplier_eight_d_disclosure_previews WHERE id = ${input.previewToken}::uuid AND organization_id = ${context.organizationId}::uuid
          AND supplier_problem_id = ${id}::uuid AND actor_user_id = ${actor.id}::uuid FOR UPDATE`;
      if (!preview || preview.consumedAt || preview.expiresAt <= new Date()) adminError('CONCURRENCY_CONFLICT', 409);
      const target = await this.target(tx, context);
      const attachments = await this.attachments(tx, actor, id, input.selectedFileIds);
      const snapshot = { publicFacts: context.publicFacts, supplierName: target.displayName,
        supplierOrganizationId: context.supplierOrganizationId!, profileVersion: target.version, selectedFileIds: input.selectedFileIds, attachments };
      if (preview.rowVersion !== context.rowVersion || preview.contentVersion !== context.contentVersion
        || preview.instanceVersion !== context.instanceVersion || preview.targetSupplierOrganizationId !== context.supplierOrganizationId
        || preview.digest !== digest(snapshot) || canonical(preview.snapshot) !== canonical(snapshot)) adminError('CONCURRENCY_CONFLICT', 409);
      const candidates = await this.recipients(tx, context.supplierOrganizationId!);
      if (!candidates.length) adminError('SUPPLIER_COLLABORATION_NOT_ENABLED', 409);
      await tx.$queryRaw`SELECT id FROM users WHERE id = ANY(${candidates.map(user => user.id)}::uuid[]) ORDER BY id FOR SHARE`;
      const current = await this.recipients(tx, context.supplierOrganizationId!, candidates.map(user => user.id));
      if (!current.length) adminError('SUPPLIER_COLLABORATION_NOT_ENABLED', 409);
      context = await this.core.disclosureContext(tx, actor, id);
      const now = new Date();
      if (preview.expiresAt <= now || context.rowVersion >= 2147483647 || context.contentVersion >= 2147483647) adminError('CONCURRENCY_CONFLICT', 409);
      const changed = await tx.supplierQualityProblem.updateMany({ where: { id, ownerOrganizationId: context.organizationId,
        supplierOrganizationId: context.supplierOrganizationId, version: context.contentVersion, releasedToSupplierAt: null },
      data: { releasedToSupplierAt: now, version: { increment: 1 } } });
      if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      const metadata = await tx.$executeRaw`UPDATE supplier_eight_d_controls SET row_version = row_version + 1,
        updated_by = ${actor.id}::uuid, updated_at = ${now} WHERE organization_id = ${context.organizationId}::uuid
          AND supplier_problem_id = ${id}::uuid AND row_version = ${context.rowVersion} AND closed_at IS NULL AND submitted_revision_id IS NULL`;
      if (metadata !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      const publicationId = randomUUID();
      await tx.$executeRaw`INSERT INTO supplier_eight_d_publications
        (id, organization_id, supplier_problem_id, target_supplier_organization_id, preview_id, released_by, released_at, snapshot)
        VALUES (${publicationId}::uuid, ${context.organizationId}::uuid, ${id}::uuid, ${context.supplierOrganizationId}::uuid,
          ${preview.id}::uuid, ${actor.id}::uuid, ${now}, ${JSON.stringify(snapshot)}::jsonb)`;
      await tx.$executeRaw`UPDATE supplier_eight_d_disclosure_previews SET consumed_at = ${now} WHERE id = ${preview.id}::uuid`;
      const response: SupplierDisclosureReleaseResultDto = { publicationId, releasedAt: now.toISOString(), rowVersion: context.rowVersion + 1,
        contentVersion: context.contentVersion + 1, eligibleRecipientCount: current.length, notificationState: 'PENDING_PROJECTION' };
      await this.audit.record({ organizationId: context.organizationId, actorUserId: actor.id, action: 'SUPPLIER_EIGHT_D_RELEASED',
        resourceType: 'SupplierQualityProblem', resourceId: id, outcome: 'SUCCESS', traceId,
        metadata: { resourceVersion: response.rowVersion, status: 'RELEASED' } }, tx);
      await this.outbox.enqueue({ eventKey: `supplier-eight-d:${id}:RELEASE:${digest(key)}`, eventType: 'SUPPLIER_EIGHT_D_CHANGED',
        aggregateType: 'SupplierEightD', aggregateId: id, payload: { schemaVersion: 1, organizationId: context.organizationId,
          supplierProblemId: id, problemId: context.problemId, action: 'RELEASE', rowVersion: response.rowVersion,
          contentVersion: response.contentVersion, instanceVersion: context.instanceVersion } }, tx);
      await tx.$executeRaw`INSERT INTO supplier_eight_d_receipts
        (organization_id, supplier_problem_id, actor_user_id, actor_organization_id, key, action, digest, response)
        VALUES (${context.organizationId}::uuid, ${id}::uuid, ${actor.id}::uuid, ${actor.organizationId}::uuid,
          ${key}, 'RELEASE', ${requestDigest}, ${JSON.stringify(response)}::jsonb)`;
      return response;
    });
  }

  private async target(tx: Prisma.TransactionClient, context: SupplierEightDDisclosureContext) {
    if (!context.supplierOrganizationId) adminError('SUPPLIER_COLLABORATION_NOT_ENABLED', 409);
    await tx.$queryRaw`SELECT id FROM supplier_business_profiles WHERE id = ${context.profileId}::uuid AND owner_organization_id = ${context.organizationId}::uuid FOR SHARE`;
    const profile = await tx.supplierBusinessProfile.findFirst({ where: { id: context.profileId, ownerOrganizationId: context.organizationId } });
    if (!profile || profile.supplierOrganizationId !== context.supplierOrganizationId) adminError('CONCURRENCY_CONFLICT', 409);
    const supplier = await tx.organization.findFirst({ where: { id: context.supplierOrganizationId, type: 'SUPPLIER', status: 'ACTIVE' } });
    if (!supplier) adminError('SUPPLIER_COLLABORATION_NOT_ENABLED', 409);
    return profile;
  }

  private recipients(tx: Prisma.TransactionClient, organizationId: string, ids?: string[]) {
    return tx.$queryRaw<{ id: string }[]>`SELECT u.id FROM users u JOIN organizations o ON o.id = u.organization_id
      WHERE u.organization_id = ${organizationId}::uuid AND u.account_type = 'SUPPLIER' AND u.status = 'ACTIVE'
        AND o.type = 'SUPPLIER' AND o.status = 'ACTIVE' ${ids ? Prisma.sql`AND u.id = ANY(${ids}::uuid[])` : Prisma.empty}
        AND ${featurePredicate(Prisma.sql`u.id`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'supplier-quality:responses:read'`)}
        AND ${featurePredicate(Prisma.sql`u.id`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'supplier-quality:responses:write'`)}
        AND ${featurePredicate(Prisma.sql`u.id`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'workflow:act'`)} ORDER BY u.id`;
  }

  private selection(ids: string[]) {
    if (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !isUUID(id))) adminError('SUPPLIER_INPUT_INVALID', 400);
  }

  private async attachments(tx: Prisma.TransactionClient, actor: SupplierEightDActor, id: string, fileIds: string[]) {
    const refs = await this.files.readReportEvidence(tx, actor, [{ resource: { resourceType: 'supplier-eight-d-disclosure', resourceId: id }, fileIds }]);
    // Keep the immutable version/scan proof private in the publication, never return storage keys.
    return refs.map(({ objectKey: _key, objectVersionId, ...file }) => ({ ...file, objectVersionId }));
  }

  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(work, { isolationLevel: 'ReadCommitted', timeout: 30_000 }); }
    catch (error) { if (isSecurityConcurrencyConflict(error)) adminError('CONCURRENCY_CONFLICT', 409); throw error; }
  }
}
