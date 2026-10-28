import type { AdminActor, AdminTransaction } from '../security/admin-mutation.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export interface SupplierCollaborationProjection {
  sourceKind: 'PROCESS_LEDGER' | 'CUSTOMER_LEDGER' | 'NEW_PRODUCT_SELECTION';
  sourceId: string;
  canonicalFactKey: string;
  reviewSource?: { kind: 'PROCESS_LEDGER'; id: string };
  materialItemId: string;
  verification: 'UNREVIEWED' | 'CONFIRMED_DEFECT' | 'NOT_MATERIAL' | 'NEGOTIATED' | 'RETURN_ANALYSIS' | null;
  progress: string | null;
  result: string | null;
}

export interface SupplierCollaborationProjectionPort {
  supplierCollaborationPredicate(tx: AdminTransaction, actualActor: AdminActor, sourceIdSql: Prisma.Sql): Promise<Prisma.Sql>;
  supplierCollaborationProjection(tx: AdminTransaction, actualActor: AdminActor, sourceId: string): Promise<SupplierCollaborationProjection[]>;
}
