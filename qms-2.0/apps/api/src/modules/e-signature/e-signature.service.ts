import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { ApprovalSignatureQueryDto, ESignatureQueryDto, RegisterESignatureDto, RevokeESignatureDto, SignApprovalDto } from './e-signature.dto.js';
import { APPROVAL_READ_PERMISSION, APPROVAL_SIGN_PERMISSION, SIGNATURE_READ_PERMISSION, SIGNATURE_WRITE_PERMISSION, fail, normalizeSignatureData, normalizeText } from './e-signature.rules.js';

type Row = Record<string, unknown>;

function signingKey() { return process.env.QMS_RATE_LIMIT_SECRET?.trim() || 'qms-development-signature-key-not-for-production'; }
function digest(value: string) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function signedDigest(input: { organizationId: string; resourceType: string; resourceId: string; resourceVersion: number; signatureFingerprint: string }) {
  return createHmac('sha256', signingKey()).update(`${input.organizationId}:${input.resourceType}:${input.resourceId}:${input.resourceVersion}:${input.signatureFingerprint}`, 'utf8').digest('hex');
}

@Injectable()
export class ESignatureService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  private personalOrganization(actor: AdminActor, requested?: string) {
    if (actor.accountType !== 'INTERNAL' || (requested && requested !== actor.organizationId)) fail('ORGANIZATION_SCOPE_DENIED', 403);
    return actor.organizationId;
  }

  private signature(row: Row) {
    return {
      id: String(row.id), organizationId: String(row.organization_id), userId: String(row.user_id), label: String(row.label), fingerprint: String(row.fingerprint),
      status: String(row.status), version: Number(row.version), createdAt: new Date(String(row.created_at)).toISOString(), revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
    };
  }

  private approval(row: Row) {
    return {
      id: String(row.id), organizationId: String(row.organization_id), signatureId: String(row.signature_id), signerUserId: String(row.signer_user_id), resourceType: String(row.resource_type),
      resourceId: String(row.resource_id), resourceVersion: Number(row.resource_version), signatureFingerprint: String(row.signature_fingerprint), signedDigest: String(row.signed_digest),
      note: row.note ? String(row.note) : null, signedAt: new Date(String(row.signed_at)).toISOString(),
    };
  }

  async list(actor: AdminActor, query: ESignatureQueryDto) {
    const organizationId = this.personalOrganization(actor, query.organizationId);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, SIGNATURE_READ_PERMISSION);
      const status = query.status ? Prisma.sql`AND status = ${query.status}` : Prisma.empty;
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM user_signatures WHERE organization_id = ${organizationId}::uuid AND user_id = ${actor.id}::uuid ${status} ORDER BY created_at DESC, id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
      const count = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM user_signatures WHERE organization_id = ${organizationId}::uuid AND user_id = ${actor.id}::uuid ${status}`);
      return { items: rows.map((row) => this.signature(row)), total: Number(count[0]?.count ?? 0), page: query.page, pageSize: query.pageSize };
    });
  }

  async summary(actor: AdminActor) {
    const organizationId = this.personalOrganization(actor);
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, organizationId, SIGNATURE_READ_PERMISSION);
      const rows = await transaction.$queryRaw<Row[]>`SELECT id, label, status, version, created_at, revoked_at FROM user_signatures WHERE organization_id = ${organizationId}::uuid AND user_id = ${actor.id}::uuid ORDER BY created_at DESC, id DESC`;
      return rows.map((row) => ({ id: String(row.id), label: String(row.label), status: String(row.status), version: Number(row.version), createdAt: new Date(String(row.created_at)).toISOString(), revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null }));
    });
  }

  async register(actor: AdminActor, input: RegisterESignatureDto, traceId: string, key?: string) {
    const organizationId = this.personalOrganization(actor, input.organizationId);
    const label = normalizeText(input.label, 120);
    const fingerprint = digest(normalizeSignatureData(input.signatureData));
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'E_SIGNATURE_REGISTERED', payload: { organizationId, label, fingerprint }, permission: SIGNATURE_WRITE_PERMISSION }, async (tx) => {
      const id = randomUUID();
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO user_signatures (id, organization_id, user_id, label, fingerprint) VALUES (${id}::uuid, ${organizationId}::uuid, ${actor.id}::uuid, ${label}, ${fingerprint}) RETURNING *`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'E_SIGNATURE_REGISTERED', resourceType: 'UserSignature', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: 1 } }, tx);
      return this.signature(rows[0]!);
    });
  }

  async revoke(actor: AdminActor, id: string, input: RevokeESignatureDto, traceId: string, key?: string) {
    const organizationId = this.personalOrganization(actor, input.organizationId);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'E_SIGNATURE_REVOKED', payload: { id, expectedVersion: input.expectedVersion }, permission: SIGNATURE_WRITE_PERMISSION }, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>`UPDATE user_signatures SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, version = version + 1 WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND user_id = ${actor.id}::uuid AND status = 'ACTIVE' AND version = ${input.expectedVersion} RETURNING *`;
      if (!rows[0]) fail('E_SIGNATURE_CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'E_SIGNATURE_REVOKED', resourceType: 'UserSignature', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: Number(rows[0]!.version) } }, tx);
      return this.signature(rows[0]!);
    });
  }

  async signApproval(actor: AdminActor, input: SignApprovalDto, traceId: string, key?: string) {
    const organizationId = this.personalOrganization(actor, input.organizationId);
    const resourceType = normalizeText(input.resourceType, 64).toUpperCase();
    const resourceId = normalizeText(input.resourceId, 128);
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(resourceType)) fail('E_SIGNATURE_RESOURCE_INVALID');
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'E_SIGNATURE_APPROVAL_SIGNED', payload: { signatureId: input.signatureId, resourceType, resourceId, resourceVersion: input.resourceVersion, note: input.note?.trim() || null }, permission: APPROVAL_SIGN_PERMISSION }, async (tx) => {
      const signatures = await tx.$queryRaw<Row[]>`SELECT * FROM user_signatures WHERE id = ${input.signatureId}::uuid AND organization_id = ${organizationId}::uuid AND user_id = ${actor.id}::uuid AND status = 'ACTIVE' FOR UPDATE`;
      const signature = signatures[0];
      if (!signature) fail('E_SIGNATURE_NOT_FOUND', 404);
      const fingerprint = String(signature.fingerprint);
      const signed = signedDigest({ organizationId, resourceType, resourceId, resourceVersion: input.resourceVersion, signatureFingerprint: fingerprint });
      const id = randomUUID();
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO approval_signatures (id, organization_id, signature_id, signer_user_id, resource_type, resource_id, resource_version, signature_fingerprint, signed_digest, note) VALUES (${id}::uuid, ${organizationId}::uuid, ${input.signatureId}::uuid, ${actor.id}::uuid, ${resourceType}, ${resourceId}, ${input.resourceVersion}, ${fingerprint}, ${signed}, ${input.note?.trim() || null}) RETURNING *`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'E_SIGNATURE_APPROVAL_SIGNED', resourceType, resourceId, outcome: 'SUCCESS', traceId, metadata: { signatureId: input.signatureId, resourceVersion: input.resourceVersion, signedDigest: signed } }, tx);
      return this.approval(rows[0]!);
    });
  }

  async approvals(actor: AdminActor, query: ApprovalSignatureQueryDto) {
    const organizationId = this.personalOrganization(actor, query.organizationId);
    const resourceType = normalizeText(query.resourceType, 64).toUpperCase();
    const resourceId = normalizeText(query.resourceId, 128);
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(resourceType)) fail('E_SIGNATURE_RESOURCE_INVALID');
    return this.prisma.$transaction(async (tx: AdminTransaction) => {
      await assertAdminAccess(tx, actor, organizationId, APPROVAL_READ_PERMISSION);
      const rows = await tx.$queryRaw<Row[]>`SELECT * FROM approval_signatures WHERE organization_id = ${organizationId}::uuid AND resource_type = ${resourceType} AND resource_id = ${resourceId} AND resource_version = ${query.resourceVersion} ORDER BY signed_at ASC, id ASC`;
      return rows.map((row) => this.approval(row));
    });
  }
}
