import { Prisma } from '../../generated/prisma/client.js';

export function domainSourceLinkChanges(tx: Prisma.TransactionClient, scope: {
  organizationId: string; problemIndexId: string; sourceDomain: string; sourceType: string;
}, ids: string[]) {
  return tx.domainSourceIssueLinkHistory.findMany({
    where: { ...scope, id: { in: ids }, action: { in: ['LINKED', 'UNLINKED'] } },
    select: { id: true, action: true, sourceId: true, sourceSnapshot: true },
  });
}

export function recentDomainSourceLinkChanges(tx: Prisma.TransactionClient, scope: {
  organizationId: string; sourceDomain: string; sourceType: string; sourceId: string;
}, limit: number) {
  return tx.$queryRaw<{ id: string; changedAt: Date; action: 'LINKED' | 'UNLINKED'; actorName: string }[]>(Prisma.sql`
    SELECT history.id, history.changed_at AS "changedAt", history.action,
      COALESCE(NULLIF(BTRIM(actor.full_name), ''), actor.username) AS "actorName"
    FROM domain_source_issue_link_history history
    JOIN users actor ON actor.id = history.actor_user_id AND actor.organization_id = history.organization_id
      AND actor.account_type = 'INTERNAL'
    WHERE history.organization_id = ${scope.organizationId}::uuid AND history.source_domain = ${scope.sourceDomain}
      AND history.source_type = ${scope.sourceType} AND history.source_id = ${scope.sourceId}::uuid
      AND history.action IN ('LINKED', 'UNLINKED')
    ORDER BY history.changed_at DESC, history.id DESC
    LIMIT ${limit}
  `);
}
