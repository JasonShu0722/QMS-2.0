import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication, assertRecentAuthentication } from '../../common/security/session-security.js';
import { decryptSecret, encryptSecret } from '../../common/security/security-keyring.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { CreateIntegrationCredentialDto, IntegrationConnectionDto, IntegrationCredentialDto, IntegrationCredentialPageDto, IntegrationPageQueryDto } from './integration-admin.dto.js';
import { assertIntegrationOrganization, integrationEndpointDto, integrationError, integrationInteger, integrationScope, integrationText, lockIntegrationEndpoint } from './integration-types.js';

type CredentialRow = Omit<IntegrationCredentialDto, 'secret' | 'createdAt' | 'expiresAt' | 'revokedAt'> & { createdAt: Date; expiresAt: Date | null; revokedAt: Date | null };
type CopyableCredentialRow = Pick<CredentialRow, 'id' | 'name' | 'expiresAt'> & { secretHash: string; secretCiphertext: string | null };
const projection = Prisma.sql`id, organization_id AS "organizationId", endpoint_id AS "endpointId", created_by_id AS "createdById", name, expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt"`;
const credentialDto = (row: CredentialRow): IntegrationCredentialDto => ({ ...row, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null, revokedAt: row.revokedAt?.toISOString() ?? null });
const managePermissions = ['integration:manage', 'integration:credentials:manage'];
const credentialContext = (organizationId: string, endpointId: string, credentialId: string) => `integration-credential:${organizationId.toLowerCase()}:${endpointId.toLowerCase()}:${credentialId}`;
const activeCredential = Prisma.sql`revoked_at IS NULL AND (expires_at IS NULL OR expires_at > clock_timestamp())`;

@Injectable()
export class IntegrationCredentialService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  async connection(actor: AdminActor, endpointId: string, credentialId: string | undefined, traceId: string): Promise<IntegrationConnectionDto> {
    const organizationId = integrationScope(actor);
    return this.prisma.$transaction(async transaction => {
      await assertAdminAccess(transaction, actor, organizationId, managePermissions);
      await assertActiveAuthentication(transaction, actor);
      const endpoint = await lockIntegrationEndpoint(transaction, organizationId, endpointId);
      const selector = credentialId ? Prisma.sql`AND id = ${credentialId}::uuid` : Prisma.empty;
      const rows = await transaction.$queryRaw<CopyableCredentialRow[]>(Prisma.sql`
        SELECT id, name, expires_at AS "expiresAt", secret_hash AS "secretHash", secret_ciphertext AS "secretCiphertext"
        FROM integration_credentials
        WHERE organization_id = ${endpoint.organizationId}::uuid AND endpoint_id = ${endpoint.id}::uuid AND ${activeCredential} ${selector}
        ORDER BY created_at DESC, id DESC FOR UPDATE`);
      await assertActiveAuthentication(transaction, actor);
      await assertAdminAccess(transaction, actor, endpoint.organizationId, managePermissions);
      const [clock] = await transaction.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      const active = rows.filter(row => !row.expiresAt || row.expiresAt > clock!.now);
      if (!active.length) integrationError('INTEGRATION_CREDENTIAL_REQUIRED', 409);
      const credential = active.find(row => row.secretCiphertext !== null);
      if (!credential?.secretCiphertext) integrationError('INTEGRATION_CREDENTIAL_SECRET_UNAVAILABLE', 409);
      const secret = decryptSecret(credential.secretCiphertext, credentialContext(endpoint.organizationId, endpoint.id, credential.id));
      if (createHash('sha256').update(secret).digest('hex') !== credential.secretHash.trim()) integrationError('INTEGRATION_CONFIGURATION_UNAVAILABLE', 503);
      await this.audit.record({ organizationId: endpoint.organizationId, actorUserId: actor.id, action: 'INTEGRATION_CONNECTION_READ', resourceType: 'IntegrationCredential', resourceId: credential.id, outcome: 'SUCCESS', traceId, metadata: { endpointId: endpoint.id, credentialId: credential.id } }, transaction);
      return { endpoint: integrationEndpointDto(endpoint), credentialId: credential.id, credentialName: credential.name, authorization: `Bearer ${credential.id}.${secret}`, expiresAt: credential.expiresAt?.toISOString() ?? null };
    }, { isolationLevel: 'ReadCommitted' });
  }

  async listCredentials(actor: AdminActor, endpointId: string, query: IntegrationPageQueryDto): Promise<IntegrationCredentialPageDto> {
    const organizationId = integrationScope(actor);
    const page = integrationInteger(query.page ?? 1, 1, 10000), limit = integrationInteger(query.limit ?? 20, 1, 100);
    return this.prisma.$transaction(async transaction => {
      await assertAdminAccess(transaction, actor, organizationId, 'integration:credentials:manage');
      await assertIntegrationOrganization(transaction, organizationId);
      const [endpoint] = await transaction.$queryRaw<{ id: string }[]>`SELECT id FROM integration_endpoints WHERE id = ${endpointId}::uuid AND organization_id = ${organizationId}::uuid AND deleted_at IS NULL`;
      if (!endpoint) integrationError('INTEGRATION_ENDPOINT_NOT_FOUND', 404);
      const rows = await transaction.$queryRaw<CredentialRow[]>(Prisma.sql`SELECT ${projection} FROM integration_credentials WHERE organization_id = ${organizationId}::uuid AND endpoint_id = ${endpointId}::uuid ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
      const [count] = await transaction.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM integration_credentials WHERE organization_id = ${organizationId}::uuid AND endpoint_id = ${endpointId}::uuid`;
      return { items: rows.map(credentialDto), total: count!.total, page, limit };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async createCredential(actor: AdminActor, endpointId: string, input: CreateIntegrationCredentialDto, traceId: string, key?: string): Promise<IntegrationCredentialDto> {
    const organizationId = integrationScope(actor);
    const data = { endpointId, name: integrationText(input.name, 120), validityDays: input.validityDays === null ? null : integrationInteger(input.validityDays ?? 90, 1, 365) };
    let issuedSecret: string | undefined;
    const saved = await this.mutations.run({ actor, organizationId, key, traceId, action: 'INTEGRATION_CREDENTIAL_CREATED', payload: data, permission: managePermissions, isolationLevel: 'ReadCommitted' }, async transaction => {
      const [active] = await transaction.$queryRaw<{ count: number }[]>(Prisma.sql`SELECT count(*)::int AS count FROM integration_credentials WHERE organization_id = ${organizationId}::uuid AND endpoint_id = ${endpointId}::uuid AND ${activeCredential}`);
      if ((active?.count ?? 0) >= 2) integrationError('INTEGRATION_CREDENTIAL_LIMIT', 409);
      const credentialId = randomUUID(), secret = randomBytes(32).toString('base64url');
      const secretHash = createHash('sha256').update(secret).digest('hex');
      const secretCiphertext = encryptSecret(secret, credentialContext(organizationId, endpointId, credentialId));
      const [row] = await transaction.$queryRaw<CredentialRow[]>(Prisma.sql`INSERT INTO integration_credentials (id, organization_id, endpoint_id, created_by_id, name, secret_hash, secret_ciphertext, expires_at)
        VALUES (${credentialId}::uuid, ${organizationId}::uuid, ${endpointId}::uuid, ${actor.id}::uuid, ${data.name}, ${secretHash}, ${secretCiphertext}, clock_timestamp() + (${data.validityDays}::int * INTERVAL '1 day')) RETURNING ${projection}`);
      if (!row) integrationError('INTEGRATION_CONFIGURATION_UNAVAILABLE', 503);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'INTEGRATION_CREDENTIAL_CREATED', resourceType: 'IntegrationCredential', resourceId: credentialId, outcome: 'SUCCESS', traceId, metadata: { endpointId, credentialId } }, transaction);
      issuedSecret = `${credentialId}.${secret}`;
      return credentialDto(row);
    }, async transaction => {
      await lockIntegrationEndpoint(transaction, organizationId, endpointId);
      await assertRecentAuthentication(transaction, actor);
      await assertAdminAccess(transaction, actor, organizationId, managePermissions);
    });
    return issuedSecret ? { ...saved, secret: issuedSecret } : saved;
  }

  async revokeCredential(actor: AdminActor, endpointId: string, credentialId: string, traceId: string, key?: string): Promise<IntegrationCredentialDto> {
    const organizationId = integrationScope(actor);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'INTEGRATION_CREDENTIAL_REVOKED', payload: { endpointId, credentialId }, permission: managePermissions, isolationLevel: 'ReadCommitted' }, async transaction => {
      const [row] = await transaction.$queryRaw<CredentialRow[]>(Prisma.sql`UPDATE integration_credentials SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE organization_id = ${organizationId}::uuid AND endpoint_id = ${endpointId}::uuid AND id = ${credentialId}::uuid RETURNING ${projection}`);
      if (!row) integrationError('INTEGRATION_CREDENTIAL_NOT_FOUND', 404);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'INTEGRATION_CREDENTIAL_REVOKED', resourceType: 'IntegrationCredential', resourceId: credentialId, outcome: 'SUCCESS', traceId, metadata: { endpointId, credentialId } }, transaction);
      return credentialDto(row);
    }, async transaction => {
      await lockIntegrationEndpoint(transaction, organizationId, endpointId);
      const [row] = await transaction.$queryRaw<{ id: string }[]>`SELECT id FROM integration_credentials WHERE organization_id = ${organizationId}::uuid AND endpoint_id = ${endpointId}::uuid AND id = ${credentialId}::uuid FOR UPDATE`;
      await assertRecentAuthentication(transaction, actor);
      await assertAdminAccess(transaction, actor, organizationId, managePermissions);
      if (!row) integrationError('INTEGRATION_CREDENTIAL_NOT_FOUND', 404);
    });
  }
}
