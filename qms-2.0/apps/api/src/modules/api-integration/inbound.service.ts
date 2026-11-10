import { HttpException, Injectable } from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import type { Request } from 'express';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { encryptSecret } from '../../common/security/security-keyring.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { readOrganizationRuntime } from '../organization/organization-runtime.read-model.js';
import { INBOUND_CONFIGURATION, type InboundConfigurationContext, type InboundIdentity, type InboundReceiptDto, type InboundResult } from './inbound.dto.js';

type Endpoint = {
  id: string; organization_id: string; status: string; deleted_at: Date | null; version: number; return_receipt: boolean;
  max_body_bytes: number; rate_per_minute: number; body_retention_days: number; capacity_bytes: number;
  used_body_bytes: bigint; allowed_ips: string[];
};
type Credential = { id: string; secret_hash: string; expires_at: Date | null; revoked_at: Date | null; now: Date };
type Receipt = { id: string; message_id: string; received_at: Date };
type Transaction = Prisma.TransactionClient;
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const reject = (code: string, status: number): never => { throw new HttpException({ code, message: '接口请求无法处理' }, status); };

export class InboundRateLimitException extends HttpException {
  constructor(readonly retryAfter: number) { super({ code: 'INTEGRATION_RATE_LIMITED', message: '接口请求过于频繁' }, 429); }
}

export function inboundIpAllowed(address: string, ranges: string[]): boolean {
  if (!ranges.length) return true;
  const normalized = address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
  const version = isIP(normalized);
  if (!version) return false;
  try {
    const blockList = new BlockList();
    for (const range of ranges) {
      const [network, prefix, extra] = range.split('/');
      const networkVersion = isIP(network!);
      if (!networkVersion || extra !== undefined) return false;
      const family = networkVersion === 4 ? 'ipv4' : 'ipv6';
      if (prefix === undefined) blockList.addAddress(network!, family);
      else {
        if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > (networkVersion === 4 ? 32 : 128)) return false;
        blockList.addSubnet(network!, Number(prefix), family);
      }
    }
    return blockList.check(normalized, version === 4 ? 'ipv4' : 'ipv6');
  } catch { return false; }
}

function oneHeader(request: Request, name: string, code: string, status: number): string {
  let occurrences = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) if (request.rawHeaders[index]!.toLowerCase() === name) occurrences++;
  const value = request.headers[name];
  if (occurrences !== 1 || typeof value !== 'string') reject(code, status);
  return value as string;
}

function validBody(request: Request, maximum: number): { bytes: Buffer; text: string } {
  const contentType = request.headers['content-type'];
  const contentEncoding = request.headers['content-encoding'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType)
    || contentEncoding && (typeof contentEncoding !== 'string' || contentEncoding.toLowerCase() !== 'identity')) reject('INTEGRATION_CONTENT_TYPE_UNSUPPORTED', 415);
  if (!Buffer.isBuffer(request.body)) reject('INTEGRATION_MESSAGE_INVALID', 400);
  const bytes = request.body as Buffer;
  if (bytes.length > maximum || bytes.length > 1048576) reject('INTEGRATION_BODY_TOO_LARGE', 413);
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    let depth = 0, quoted = false, escaped = false;
    for (const character of text) {
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === '{' || character === '[') { if (++depth > 32) throw new Error(); }
      else if (character === '}' || character === ']') depth--;
    }
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return { bytes, text };
  } catch { return reject('INTEGRATION_MESSAGE_INVALID', 400); }
}

@Injectable()
export class InboundService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  async authenticate(request: Request): Promise<InboundIdentity> {
    const authorization = oneHeader(request, 'authorization', 'INTEGRATION_AUTH_INVALID', 401);
    const match = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43,128})$/i.exec(authorization);
    const endpoint = request.params.endpointId;
    if (!match || !isUUID(match[1]) || typeof endpoint !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(endpoint)) return reject('INTEGRATION_AUTH_INVALID', 401);
    try {
      const [credential] = await this.prisma.$queryRaw<(Credential & { organization_id: string; endpoint_id: string; endpoint_code: string })[]>`SELECT c.id,c.organization_id,c.endpoint_id,c.secret_hash,c.expires_at,c.revoked_at,e.code AS endpoint_code,clock_timestamp() AS now
        FROM integration_credentials c JOIN integration_endpoints e ON e.id=c.endpoint_id AND e.organization_id=c.organization_id
        WHERE c.id=${match[1]}::uuid AND e.deleted_at IS NULL`;
      const secretDigest = digest(match[2]!);
      const expected = credential?.secret_hash?.trim();
      if (!credential || !expected || !/^[a-f0-9]{64}$/.test(expected) || !timingSafeEqual(Buffer.from(secretDigest, 'hex'), Buffer.from(expected, 'hex'))
        || credential.revoked_at || (credential.expires_at !== null && credential.expires_at <= credential.now)
        || (endpoint !== credential.endpoint_code && endpoint.toLowerCase() !== credential.endpoint_id)) return reject('INTEGRATION_AUTH_INVALID', 401);
      return { organizationId: credential.organization_id, endpointId: credential.endpoint_id, credentialId: credential.id, secretDigest };
    } catch (error) { return this.failure(error); }
  }

  private async lockedEndpoint(tx: Transaction, identity: InboundIdentity, address: string, request: InboundConfigurationContext): Promise<Endpoint> {
    const organization = await readOrganizationRuntime(tx, identity.organizationId, true);
    if (!organization || organization.status !== 'ACTIVE' || organization.type !== 'INTERNAL' || organization.deletedAt || organization.configurationRequired) reject('INTEGRATION_ACCESS_DENIED', 403);
    const endpoints = await tx.$queryRaw<Endpoint[]>`SELECT id,organization_id,status,deleted_at,version,return_receipt,max_body_bytes,rate_per_minute,body_retention_days,capacity_bytes,used_body_bytes,allowed_ips
      FROM integration_endpoints WHERE organization_id=${identity.organizationId}::uuid AND id=${identity.endpointId}::uuid FOR UPDATE`;
    const endpoint = endpoints[0];
    if (endpoint?.deleted_at) reject('INTEGRATION_AUTH_INVALID', 401);
    if (endpoint) request[INBOUND_CONFIGURATION] = { version: endpoint.version, returnReceipt: endpoint.return_receipt };
    if (!endpoint || endpoint.status !== 'ENABLED' || !inboundIpAllowed(address, endpoint.allowed_ips)) reject('INTEGRATION_ACCESS_DENIED', 403);
    // Take the expiry timestamp after the credential row lock is held.
    const [credential] = await tx.$queryRaw<Credential[]>`WITH locked_credential AS (
      SELECT id,secret_hash,expires_at,revoked_at FROM integration_credentials
      WHERE id=${identity.credentialId}::uuid AND organization_id=${identity.organizationId}::uuid AND endpoint_id=${identity.endpointId}::uuid FOR UPDATE
    ) SELECT *,clock_timestamp() AS now FROM locked_credential`;
    if (!credential || credential.revoked_at || (credential.expires_at !== null && credential.expires_at <= credential.now)
      || !timingSafeEqual(Buffer.from(credential.secret_hash.trim(), 'hex'), Buffer.from(identity.secretDigest, 'hex'))) reject('INTEGRATION_AUTH_INVALID', 401);
    return endpoint!;
  }

  async receive(request: Request & InboundConfigurationContext, identity: InboundIdentity): Promise<InboundResult> {
    const address = request.ip ?? request.socket.remoteAddress ?? '';
    try {
      const initial = await this.prisma.$transaction(async tx => {
        const endpoint = await this.lockedEndpoint(tx, identity, address, request);
        const windows = await tx.$queryRaw<{ requests: number; retry_after: number }[]>`INSERT INTO integration_rate_windows(endpoint_id,window_started_at,requests)
          VALUES(${identity.endpointId}::uuid,date_trunc('minute',clock_timestamp()),1)
          ON CONFLICT(endpoint_id,window_started_at) DO UPDATE SET requests=integration_rate_windows.requests+1
          WHERE integration_rate_windows.requests<${endpoint.rate_per_minute}
          RETURNING requests, GREATEST(1,ceil(extract(epoch FROM window_started_at+interval '1 minute'-clock_timestamp())))::int AS retry_after`;
        if (!windows.length) {
          const times = await tx.$queryRaw<{ seconds: number }[]>`SELECT GREATEST(1,ceil(extract(epoch FROM date_trunc('minute',clock_timestamp())+interval '1 minute'-clock_timestamp())))::int AS seconds`;
          throw new InboundRateLimitException(times[0]!.seconds);
        }
        return endpoint;
      }, { isolationLevel: 'ReadCommitted' });
      const body = validBody(request, initial.max_body_bytes), traceId = requestTraceId(request);
      return await this.prisma.$transaction(async tx => {
        const endpoint = await this.lockedEndpoint(tx, identity, address, request);
        if (body.bytes.length > endpoint.max_body_bytes) reject('INTEGRATION_BODY_TOO_LARGE', 413);
        const times = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
        const now = times[0]!.now;
        await tx.$executeRaw`INSERT INTO integration_scope_capacities(organization_id) VALUES(${identity.organizationId}::uuid) ON CONFLICT DO NOTHING`;
        const capacities = await tx.$queryRaw<{ used_body_bytes: bigint; receipt_count: number }[]>`SELECT used_body_bytes,receipt_count FROM integration_scope_capacities WHERE organization_id=${identity.organizationId}::uuid FOR UPDATE`;
        const capacity = capacities[0]!, receiptId = randomUUID();
        const ciphertext = encryptSecret(body.text, `integration:${identity.organizationId}:${identity.endpointId}:${receiptId}`);
        const payloadBytes = Buffer.byteLength(ciphertext, 'utf8');
        if (Number(endpoint.used_body_bytes) + payloadBytes > endpoint.capacity_bytes || Number(capacity.used_body_bytes) + payloadBytes > 1073741824 || capacity.receipt_count >= 100000) reject('INTEGRATION_CAPACITY_UNAVAILABLE', 503);
        const snapshot = { version: endpoint.version, returnReceipt: endpoint.return_receipt, maxBodyBytes: endpoint.max_body_bytes, bodyRetentionDays: endpoint.body_retention_days };
        const bodyExpiresAt = new Date(now.getTime() + endpoint.body_retention_days * 86400000), metadataExpiresAt = new Date(now.getTime() + 90 * 86400000);
        await tx.$executeRaw`INSERT INTO integration_receipts(id,organization_id,endpoint_id,credential_id,message_id,configuration_version,configuration_snapshot,received_at,body_expires_at,metadata_expires_at,payload_ciphertext,payload_bytes)
          VALUES(${receiptId}::uuid,${identity.organizationId}::uuid,${identity.endpointId}::uuid,${identity.credentialId}::uuid,${receiptId},${endpoint.version},${JSON.stringify(snapshot)}::jsonb,${now},${bodyExpiresAt},${metadataExpiresAt},${ciphertext},${payloadBytes})`;
        await tx.$executeRaw`UPDATE integration_endpoints SET used_body_bytes=used_body_bytes+${payloadBytes} WHERE id=${identity.endpointId}::uuid`;
        await tx.$executeRaw`UPDATE integration_scope_capacities SET used_body_bytes=used_body_bytes+${payloadBytes},receipt_count=receipt_count+1 WHERE organization_id=${identity.organizationId}::uuid`;
        await this.audit.record({ actorUserId: null, organizationId: identity.organizationId, action: 'INTEGRATION_MESSAGE_RECEIVED', resourceType: 'IntegrationReceipt', resourceId: receiptId, outcome: 'SUCCESS', traceId,
          metadata: { endpointId: identity.endpointId, credentialId: identity.credentialId, receiptId, resourceVersion: endpoint.version, returnReceipt: endpoint.return_receipt } }, tx);
        return this.result(identity, endpoint, { id: receiptId, message_id: receiptId, received_at: now }, traceId);
      }, { isolationLevel: 'ReadCommitted' });
    } catch (error) { return this.failure(error); }
  }

  private result(identity: InboundIdentity, endpoint: Endpoint, receipt: Receipt, traceId: string): InboundResult {
    const dto: InboundReceiptDto = { receiptId: receipt.id, messageId: receipt.message_id, receivedAt: receipt.received_at.toISOString(), status: 'RECEIVED' };
    return { organizationId: identity.organizationId, endpointId: identity.endpointId, credentialId: identity.credentialId,
      statusCode: endpoint.return_receipt ? 201 : 204, receipt: dto, traceId, configurationVersion: endpoint.version, returnReceipt: endpoint.return_receipt };
  }

  private failure(error: unknown): never {
    if (error instanceof HttpException) throw error;
    return reject('INTEGRATION_STORAGE_UNAVAILABLE', 503);
  }
}
