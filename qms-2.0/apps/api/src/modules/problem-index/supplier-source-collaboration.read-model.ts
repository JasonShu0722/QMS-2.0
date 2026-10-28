import { BadRequestException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';

export type CollaborationProblemDomain = 'process-quality' | 'customer-quality' | 'new-product-quality';
export interface CollaborationProblemCandidate { problemId: string; domainCode: CollaborationProblemDomain }
export interface CollaborationSourceReference { sourceDomain: string; sourceType: string; sourceId: string }

const active = { archivedAt: null, closedAt: null, status: { notIn: ['CLOSED', 'ARCHIVED'] as ('CLOSED' | 'ARCHIVED')[] } };
const domains: CollaborationProblemDomain[] = ['process-quality', 'customer-quality', 'new-product-quality'];
type ScanQuery = { after?: string; scanLimit?: number };

function limit(organizationId: string, query: ScanQuery) {
  const scanLimit = query.scanLimit ?? 50;
  if (!isUUID(organizationId) || query.after !== undefined && !isUUID(query.after)
    || !Number.isInteger(scanLimit) || scanLimit < 1 || scanLimit > 100) throw new BadRequestException('Invalid collaboration scan');
  return scanLimit;
}

function page(rows: { id: string; domainCode: string }[], scanLimit: number) {
  const candidates: CollaborationProblemCandidate[] = rows.slice(0, scanLimit).map(row => ({ problemId: row.id, domainCode: row.domainCode as CollaborationProblemDomain }));
  return { candidates, scannedCount: candidates.length, nextCursor: rows.length > scanLimit ? candidates.at(-1)!.problemId : null };
}

@Injectable()
export class SupplierSourceCollaborationReadModel {
  // Platform-only inventory seam; request-facing callers must use scan with source-owned eligibility.
  async scanTrusted(tx: Prisma.TransactionClient, organizationId: string, query: ScanQuery = {}) {
    const scanLimit = limit(organizationId, query);
    const rows = await tx.problemIndex.findMany({ where: { organizationId, ...active, domainCode: { in: domains },
      ...(query.after ? { id: { gt: query.after } } : {}) }, orderBy: { id: 'asc' }, take: scanLimit + 1,
    select: { id: true, domainCode: true } });
    return page(rows, scanLimit);
  }

  // Eligibility is server-built SQL against collaboration_link, never an HTTP value or a list of client IDs.
  async scan(tx: Prisma.TransactionClient, organizationId: string, eligibility: Prisma.Sql, query: ScanQuery = {}) {
    const scanLimit = limit(organizationId, query);
    const rows = await tx.$queryRaw<{ id: string; domainCode: string }[]>(Prisma.sql`
      SELECT collaboration_problem.id, collaboration_problem.domain_code AS "domainCode" FROM problem_indexes collaboration_problem
      WHERE collaboration_problem.organization_id = ${organizationId}::uuid AND collaboration_problem.archived_at IS NULL
        AND collaboration_problem.closed_at IS NULL AND collaboration_problem.status NOT IN ('CLOSED', 'ARCHIVED')
        AND collaboration_problem.domain_code IN (${Prisma.join(domains)})
        ${query.after ? Prisma.sql`AND collaboration_problem.id > ${query.after}::uuid` : Prisma.empty}
        AND EXISTS (SELECT 1 FROM domain_source_issue_links collaboration_link
          WHERE collaboration_link.organization_id = collaboration_problem.organization_id AND collaboration_link.problem_index_id = collaboration_problem.id
            AND collaboration_link.removed_at IS NULL AND (${eligibility}))
      ORDER BY collaboration_problem.id ASC LIMIT ${scanLimit + 1}`);
    return page(rows, scanLimit);
  }

  async currentReferences(tx: Prisma.TransactionClient, organizationId: string, problemId: string): Promise<CollaborationSourceReference[]> {
    if (!isUUID(organizationId) || !isUUID(problemId)) throw new BadRequestException('Invalid collaboration reference');
    // Source snapshots and primary-source fallback are deliberately excluded: only current active links count.
    return tx.domainSourceIssueLink.findMany({ where: { organizationId, problemIndexId: problemId, removedAt: null,
      problem: { organizationId, ...active, domainCode: { in: domains } } },
    orderBy: [{ sourceDomain: 'asc' }, { sourceType: 'asc' }, { sourceId: 'asc' }],
    select: { sourceDomain: true, sourceType: true, sourceId: true } });
  }
}
