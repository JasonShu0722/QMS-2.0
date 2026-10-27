import type { AdminActor } from '../security/admin-mutation.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const INTERNAL_EIGHT_D_REPORT_DOMAIN = Symbol('INTERNAL_EIGHT_D_REPORT_DOMAIN');

export interface InternalEightDReportDescriptor {
  readonly domainCode: string;
  readonly resourceType: string;
  readonly permissionPrefix: string;
}

export interface InternalEightDReportCore {
  readReport(tx: Prisma.TransactionClient, actor: AdminActor, problemId: string, revisionId?: string | null): Promise<{
    record: {
      problem: { organizationId: string };
      report: { closedRevisionId: string | null };
      node: { config: unknown };
    };
    revision: { id: string } | null;
    snapshot: unknown;
  }>;
}
