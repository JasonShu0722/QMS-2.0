import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { readOrganizationRuntime } from '../organization/organization-runtime.read-model.js';

type RetentionCandidate = { id: string; organization_id: string; endpoint_id: string };
type LockedReceipt = RetentionCandidate & { payload_ciphertext: string | null; payload_bytes: number; metadata_expired: boolean; body_expired: boolean };

@Injectable()
export class IntegrationRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  async purgeExpired(): Promise<{ bodies: number; receipts: number; attempts: number; windows: number }> {
    const result = { bodies: 0, receipts: 0, attempts: 0, windows: 0 };
    for (let round = 0; round<10; round++) {
      const rows = await this.prisma.$queryRaw<RetentionCandidate[]>`SELECT id,organization_id,endpoint_id FROM integration_receipts
        WHERE metadata_expires_at<=clock_timestamp() OR (payload_ciphertext IS NOT NULL AND body_expires_at<=clock_timestamp()) ORDER BY metadata_expires_at,id LIMIT 100`;
      const organizations = new Map<string, RetentionCandidate[]>();
      for (const candidate of rows) {
        const candidates = organizations.get(candidate.organization_id) ?? [];
        candidates.push(candidate);
        organizations.set(candidate.organization_id, candidates);
      }
      for (const [organizationId, candidates] of [...organizations].sort(([first], [second]) => first.localeCompare(second))) {
        try {
          const purged = await this.prisma.$transaction(async transaction => {
            const endpointIds = [...new Set(candidates.map(candidate => candidate.endpoint_id))].sort();
            const receiptIds = candidates.map(candidate => candidate.id).sort();
            await readOrganizationRuntime(transaction, organizationId, true);
            await transaction.$queryRaw(Prisma.sql`SELECT id FROM integration_endpoints WHERE organization_id=${organizationId}::uuid AND id IN (${Prisma.join(endpointIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
            const locked = await transaction.$queryRaw<LockedReceipt[]>(Prisma.sql`SELECT id,organization_id,endpoint_id,payload_ciphertext,payload_bytes,metadata_expires_at<=clock_timestamp() AS metadata_expired,body_expires_at<=clock_timestamp() AS body_expired FROM integration_receipts WHERE organization_id=${organizationId}::uuid AND id IN (${Prisma.join(receiptIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
            const expired = locked.filter(receipt => receipt.metadata_expired || receipt.payload_ciphertext !== null && receipt.body_expired);
            if (!expired.length) return { bodies: 0, receipts: 0 };
            const metadataIds = expired.filter(receipt => receipt.metadata_expired).map(receipt => receipt.id);
            const bodyIds = expired.filter(receipt => !receipt.metadata_expired).map(receipt => receipt.id);
            const releasedByEndpoint = new Map<string, number>();
            let releasedBytes = 0;
            let bodies = 0;
            for (const receipt of expired) {
              const bytes = receipt.payload_ciphertext !== null ? receipt.payload_bytes : 0;
              releasedBytes += bytes;
              if (bytes > 0) bodies++;
              releasedByEndpoint.set(receipt.endpoint_id, (releasedByEndpoint.get(receipt.endpoint_id) ?? 0) + bytes);
            }
            if (metadataIds.length) await transaction.$executeRaw(Prisma.sql`DELETE FROM integration_receipts WHERE organization_id=${organizationId}::uuid AND id IN (${Prisma.join(metadataIds.map(id => Prisma.sql`${id}::uuid`))})`);
            if (bodyIds.length) await transaction.$executeRaw(Prisma.sql`UPDATE integration_receipts SET payload_ciphertext=NULL WHERE organization_id=${organizationId}::uuid AND id IN (${Prisma.join(bodyIds.map(id => Prisma.sql`${id}::uuid`))})`);
            const releasedEndpoints = [...releasedByEndpoint].filter(([, bytes]) => bytes > 0);
            if (releasedEndpoints.length) await transaction.$executeRaw(Prisma.sql`UPDATE integration_endpoints endpoint SET used_body_bytes=endpoint.used_body_bytes-released.bytes FROM (VALUES ${Prisma.join(releasedEndpoints.map(([endpointId, bytes]) => Prisma.sql`(${endpointId}::uuid,${bytes}::bigint)`))}) AS released(id,bytes) WHERE endpoint.organization_id=${organizationId}::uuid AND endpoint.id=released.id`);
            await transaction.$executeRaw`UPDATE integration_scope_capacities SET used_body_bytes=used_body_bytes-${releasedBytes},receipt_count=receipt_count-${metadataIds.length},last_cleanup_succeeded_at=clock_timestamp() WHERE organization_id=${organizationId}::uuid`;
            return { bodies, receipts: metadataIds.length };
          }, { isolationLevel: 'ReadCommitted' });
          result.bodies += purged.bodies; result.receipts += purged.receipts;
        } catch (error) {
          try { await this.prisma.$executeRaw`UPDATE integration_scope_capacities SET last_cleanup_failed_at=clock_timestamp() WHERE organization_id=${organizationId}::uuid`; } catch {}
          throw error;
        }
      }
      const attempts = await this.prisma.$executeRaw`DELETE FROM integration_request_attempts WHERE id IN (SELECT id FROM integration_request_attempts WHERE observed_at<=clock_timestamp()-INTERVAL '7 days' ORDER BY observed_at,id LIMIT 100)`;
      const windows = await this.prisma.$executeRaw`DELETE FROM integration_rate_windows WHERE (endpoint_id,window_started_at) IN (SELECT endpoint_id,window_started_at FROM integration_rate_windows WHERE window_started_at<date_trunc('minute',clock_timestamp())-INTERVAL '1 minute' ORDER BY window_started_at,endpoint_id LIMIT 100)`;
      result.attempts += attempts; result.windows += windows;
      if (rows.length<100 && attempts<100 && windows<100) break;
    }
    return result;
  }
}
