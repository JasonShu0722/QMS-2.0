import { HttpException } from '@nestjs/common';
import { BlockList, isIP } from 'node:net';
import { Prisma } from '../../generated/prisma/client.js';
import type { AdminActor, AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { readOrganizationRuntime } from '../organization/organization-runtime.read-model.js';
import type { IntegrationEndpointDto } from './integration-admin.dto.js';

export type IntegrationEndpointRow = Omit<IntegrationEndpointDto, 'createdAt' | 'updatedAt' | 'publicUrl'> & { createdAt: Date; updatedAt: Date };
export const integrationEndpointProjection = Prisma.sql`id, organization_id AS "organizationId", code, name, description, source_code AS "sourceCode", source_name AS "sourceName", status, version, return_receipt AS "returnReceipt", max_body_bytes AS "maxBodyBytes", rate_per_minute AS "ratePerMinute", body_retention_days AS "bodyRetentionDays", capacity_bytes AS "capacityBytes", used_body_bytes::float8 AS "usedBodyBytes", allowed_ips AS "allowedIps", created_at AS "createdAt", updated_at AS "updatedAt"`;

export function integrationError(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
export function integrationScope(actor: AdminActor): string {
  if (actor.accountType !== 'INTERNAL') integrationError('ORGANIZATION_SCOPE_DENIED', 403);
  return actor.scopeOrganizationId ?? actor.organizationId;
}
export async function assertIntegrationOrganization(transaction: AdminTransaction, organizationId: string, lock = false): Promise<void> {
  const organization = await readOrganizationRuntime(transaction, organizationId, lock);
  if (organization?.type !== 'INTERNAL') integrationError('ORGANIZATION_SCOPE_DENIED', 403);
  if (organization.status !== 'ACTIVE' || organization.deletedAt || organization.configurationRequired) integrationError('ORGANIZATION_DISABLED', 403);
}
export async function lockIntegrationEndpoint(transaction: AdminTransaction, organizationId: string, endpointId: string): Promise<IntegrationEndpointRow> {
  await assertIntegrationOrganization(transaction, organizationId, true);
  const rows = await transaction.$queryRaw<IntegrationEndpointRow[]>(Prisma.sql`SELECT ${integrationEndpointProjection} FROM integration_endpoints WHERE organization_id = ${organizationId}::uuid AND id = ${endpointId}::uuid FOR UPDATE`);
  if (!rows[0]) integrationError('INTEGRATION_ENDPOINT_NOT_FOUND', 404);
  return rows[0];
}
export function integrationText(value: unknown, maximum: number, optional = false): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if ((!optional && !text) || text.length > maximum || typeof value !== 'string' && value !== undefined) integrationError('INTEGRATION_INPUT_INVALID', 400);
  return text;
}
export function integrationInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) integrationError('INTEGRATION_INPUT_INVALID', 400);
  return value;
}
export function integrationAllowedIps(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) integrationError('INTEGRATION_INPUT_INVALID', 400);
  for (const item of value) {
    if (typeof item !== 'string' || item.length > 64 || item !== item.trim()) integrationError('INTEGRATION_INPUT_INVALID', 400);
    const [address, prefix, extra] = item.split('/');
    const family = isIP(address ?? '');
    if (!family || extra !== undefined || prefix !== undefined && (!/^\d{1,3}$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128))) integrationError('INTEGRATION_INPUT_INVALID', 400);
    try {
      const block = new BlockList();
      if (prefix === undefined) block.addAddress(address!, family === 4 ? 'ipv4' : 'ipv6');
      else block.addSubnet(address!, Number(prefix), family === 4 ? 'ipv4' : 'ipv6');
    } catch { integrationError('INTEGRATION_INPUT_INVALID', 400); }
  }
  return [...new Set(value as string[])];
}
export function integrationPublicUrl(code: string): string {
  try {
    const base = new URL(process.env.QMS_PUBLIC_BASE_URL ?? '');
    const developmentLoopback = process.env.NODE_ENV !== 'production' && base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.protocol !== 'https:' && !developmentLoopback || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error();
    return new URL(`/api/v1/integrations/inbound/${encodeURIComponent(code)}/messages`, base).toString();
  } catch { integrationError('INTEGRATION_CONFIGURATION_UNAVAILABLE', 503); }
}
export function integrationEndpointDto(row: IntegrationEndpointRow): IntegrationEndpointDto {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), publicUrl: integrationPublicUrl(row.code) };
}
