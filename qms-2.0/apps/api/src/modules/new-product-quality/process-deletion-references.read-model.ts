import { Prisma } from '../../generated/prisma/client.js';
import type { AdminActor, AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { hasPlatformAdministrator } from '../../common/security/platform-administrator.js';

export async function processDeletionSelectionReferences(tx: AdminTransaction, organizationId: string, defectIds: string[], actor: AdminActor) {
  const scoped = actor.accountType === 'INTERNAL' && (actor.organizationId === organizationId || await hasPlatformAdministrator(tx, actor.id));
  return tx.$queryRaw<{ defectId: string; projectCode: string | null }[]>(Prisma.sql`SELECT s.defect_id AS "defectId", CASE WHEN ${scoped} THEN p.code ELSE NULL END AS "projectCode"
    FROM new_product_defect_selections s JOIN new_product_projects p ON p.organization_id = s.organization_id AND p.id = s.project_id
    WHERE s.organization_id = ${organizationId}::uuid AND s.defect_id IN (${Prisma.join(defectIds.map(id => Prisma.sql`${id}::uuid`))})`);
}
