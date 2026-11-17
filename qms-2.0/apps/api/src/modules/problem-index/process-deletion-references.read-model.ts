import type { AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { Prisma } from '../../generated/prisma/client.js';

export async function processDeletionProblemReferences(tx: AdminTransaction, organizationId: string, defectIds: string[], visibility: Prisma.Sql = Prisma.sql`FALSE`) {
  const problems = await tx.problemIndex.findMany({ where: { organizationId, OR: [
    { domainCode: 'process-quality', sourceType: 'process-defect', sourceId: { in: defectIds } },
    { domainSourceLinks: { some: { organizationId, sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: { in: defectIds }, removedAt: null } } },
  ] }, select: { id: true, sourceId: true, domainCode: true, sourceType: true, reportNumber: true,
    domainSourceLinks: { where: { organizationId, sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: { in: defectIds }, removedAt: null }, select: { sourceId: true } } } });
  const visible = problems.length ? await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT p.id FROM problem_indexes p
    WHERE p.organization_id = ${organizationId}::uuid AND p.id IN (${Prisma.join(problems.map(problem => Prisma.sql`${problem.id}::uuid`))}) AND (${visibility})`) : [];
  return problems.map(problem => ({ ...problem, reportNumber: visible.some(row => row.id === problem.id) ? problem.reportNumber : null }));
}
