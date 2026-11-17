import type { AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { Prisma } from '../../generated/prisma/client.js';

export async function processDeletionCopyReferences(tx: AdminTransaction, organizationId: string, defectIds: string[]) {
  return tx.$queryRaw<{ defectId: string }[]>(Prisma.sql`SELECT DISTINCT source->>'sourceId' AS "defectId"
    FROM supplier_copy_provenance p CROSS JOIN LATERAL jsonb_array_elements(p.sources) source
    WHERE p.organization_id = ${organizationId}::uuid AND source->>'kind' = 'PROCESS_LEDGER'
      AND source->>'sourceId' IN (${Prisma.join(defectIds)})`);
}
