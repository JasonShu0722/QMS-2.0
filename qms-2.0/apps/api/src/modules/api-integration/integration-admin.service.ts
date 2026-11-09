import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { assertRecentAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { CreateIntegrationEndpointDto, IntegrationEndpointDto, IntegrationEndpointPageDto, IntegrationPageQueryDto, UpdateIntegrationEndpointDto } from './integration-admin.dto.js';
import { assertIntegrationOrganization, integrationAllowedIps, integrationEndpointDto, integrationEndpointProjection, integrationError, integrationInteger, integrationPublicUrl, integrationScope, integrationText, lockIntegrationEndpoint, type IntegrationEndpointRow } from './integration-types.js';

function settings(input: Partial<CreateIntegrationEndpointDto>, current?: IntegrationEndpointRow) {
  if (input.returnReceipt !== undefined && typeof input.returnReceipt !== 'boolean') integrationError('INTEGRATION_INPUT_INVALID', 400);
  return {
    description: input.description === undefined ? current?.description ?? '' : integrationText(input.description, 1000, true),
    returnReceipt: input.returnReceipt ?? current?.returnReceipt ?? true,
    maxBodyBytes: integrationInteger(input.maxBodyBytes ?? current?.maxBodyBytes ?? 1048576, 1, 1048576),
    ratePerMinute: integrationInteger(input.ratePerMinute ?? current?.ratePerMinute ?? 60, 1, 300),
    bodyRetentionDays: integrationInteger(input.bodyRetentionDays ?? current?.bodyRetentionDays ?? 7, 1, 30),
    capacityBytes: integrationInteger(input.capacityBytes ?? current?.capacityBytes ?? 268435456, 16777216, 1073741824),
    allowedIps: integrationAllowedIps(input.allowedIps ?? current?.allowedIps ?? []),
  };
}

@Injectable()
export class IntegrationAdminService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  async listEndpoints(actor: AdminActor, query: IntegrationPageQueryDto): Promise<IntegrationEndpointPageDto> {
    const organizationId = integrationScope(actor);
    const page = integrationInteger(query.page ?? 1, 1, 10000), limit = integrationInteger(query.limit ?? 20, 1, 100);
    return this.prisma.$transaction(async transaction => {
      await assertAdminAccess(transaction, actor, organizationId, 'integration:read');
      await assertIntegrationOrganization(transaction, organizationId);
      const rows = await transaction.$queryRaw<IntegrationEndpointRow[]>(Prisma.sql`SELECT ${integrationEndpointProjection} FROM integration_endpoints WHERE organization_id = ${organizationId}::uuid ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
      const [count] = await transaction.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM integration_endpoints WHERE organization_id = ${organizationId}::uuid`;
      return { items: rows.map(integrationEndpointDto), total: count!.total, page, limit };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async endpoint(actor: AdminActor, endpointId: string): Promise<IntegrationEndpointDto> {
    const organizationId = integrationScope(actor);
    return this.prisma.$transaction(async transaction => {
      await assertAdminAccess(transaction, actor, organizationId, 'integration:read');
      await assertIntegrationOrganization(transaction, organizationId);
      const [row] = await transaction.$queryRaw<IntegrationEndpointRow[]>(Prisma.sql`SELECT ${integrationEndpointProjection} FROM integration_endpoints WHERE id = ${endpointId}::uuid AND organization_id = ${organizationId}::uuid`);
      if (!row) integrationError('INTEGRATION_ENDPOINT_NOT_FOUND', 404);
      return integrationEndpointDto(row);
    });
  }

  async createEndpoint(actor: AdminActor, input: CreateIntegrationEndpointDto, traceId: string, key?: string): Promise<IntegrationEndpointDto> {
    const organizationId = integrationScope(actor);
    const code = integrationText(input.code, 64), sourceCode = integrationText(input.sourceCode, 64);
    if (![code, sourceCode].every(value => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value))) integrationError('INTEGRATION_INPUT_INVALID', 400);
    const data = { code, sourceCode, name: integrationText(input.name, 120), sourceName: integrationText(input.sourceName, 120), ...settings(input) };
    integrationPublicUrl(randomUUID());
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'INTEGRATION_ENDPOINT_CREATED', payload: data, permission: 'integration:manage', isolationLevel: 'ReadCommitted' }, async transaction => {
      const rows = await transaction.$queryRaw<IntegrationEndpointRow[]>(Prisma.sql`INSERT INTO integration_endpoints
        (id, organization_id, code, name, description, source_code, source_name, return_receipt, max_body_bytes, rate_per_minute, body_retention_days, capacity_bytes, allowed_ips)
        VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${data.code}, ${data.name}, ${data.description}, ${data.sourceCode}, ${data.sourceName}, ${data.returnReceipt}, ${data.maxBodyBytes}, ${data.ratePerMinute}, ${data.bodyRetentionDays}, ${data.capacityBytes}, ${data.allowedIps}::text[])
        ON CONFLICT (organization_id, code) DO NOTHING RETURNING ${integrationEndpointProjection}`);
      if (!rows[0]) integrationError('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'INTEGRATION_ENDPOINT_CREATED', resourceType: 'IntegrationEndpoint', resourceId: rows[0].id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: 1, returnReceipt: data.returnReceipt } }, transaction);
      return integrationEndpointDto(rows[0]);
    }, async transaction => {
      await assertIntegrationOrganization(transaction, organizationId, true);
      await assertRecentAuthentication(transaction, actor);
      await assertAdminAccess(transaction, actor, organizationId, 'integration:manage');
    });
  }

  async updateEndpoint(actor: AdminActor, endpointId: string, input: UpdateIntegrationEndpointDto, traceId: string, key?: string): Promise<IntegrationEndpointDto> {
    const organizationId = integrationScope(actor);
    integrationInteger(input.expectedVersion, 1, 2147483647);
    const allowed = new Set(['organizationId', 'expectedVersion', 'name', 'description', 'status', 'returnReceipt', 'maxBodyBytes', 'ratePerMinute', 'bodyRetentionDays', 'capacityBytes', 'allowedIps']);
    if (Object.keys(input).some(field => !allowed.has(field)) || input.status !== undefined && !['DRAFT', 'ENABLED', 'DISABLED'].includes(input.status)) integrationError('INTEGRATION_INPUT_INVALID', 400);
    let current: IntegrationEndpointRow;
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'INTEGRATION_ENDPOINT_UPDATED', payload: { endpointId, ...input }, permission: 'integration:manage', isolationLevel: 'ReadCommitted' }, async transaction => {
      if (current.version !== input.expectedVersion) integrationError('CONCURRENCY_CONFLICT', 409);
      const data = { ...settings(input, current), name: input.name === undefined ? current.name : integrationText(input.name, 120), status: input.status ?? current.status };
      if (data.capacityBytes < current.usedBodyBytes) integrationError('INTEGRATION_CAPACITY_CONFLICT', 409);
      if (data.status === 'ENABLED') {
        const [valid] = await transaction.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM integration_credentials WHERE organization_id = ${organizationId}::uuid AND endpoint_id = ${endpointId}::uuid AND revoked_at IS NULL AND expires_at > clock_timestamp()`;
        if (!valid?.count) integrationError('INTEGRATION_CREDENTIAL_REQUIRED', 409);
      }
      const [row] = await transaction.$queryRaw<IntegrationEndpointRow[]>(Prisma.sql`UPDATE integration_endpoints SET
        name = ${data.name}, description = ${data.description}, status = ${data.status}, return_receipt = ${data.returnReceipt}, max_body_bytes = ${data.maxBodyBytes}, rate_per_minute = ${data.ratePerMinute}, body_retention_days = ${data.bodyRetentionDays}, capacity_bytes = ${data.capacityBytes}, allowed_ips = ${data.allowedIps}::text[], version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE organization_id = ${organizationId}::uuid AND id = ${endpointId}::uuid AND version = ${input.expectedVersion} RETURNING ${integrationEndpointProjection}`);
      if (!row) integrationError('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'INTEGRATION_ENDPOINT_UPDATED', resourceType: 'IntegrationEndpoint', resourceId: endpointId, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: row.version, returnReceipt: row.returnReceipt, status: row.status } }, transaction);
      return integrationEndpointDto(row);
    }, async transaction => {
      current = await lockIntegrationEndpoint(transaction, organizationId, endpointId);
      await assertRecentAuthentication(transaction, actor);
      await assertAdminAccess(transaction, actor, organizationId, 'integration:manage');
    });
  }
}
