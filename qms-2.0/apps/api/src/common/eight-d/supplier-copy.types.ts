import type { AdminActor, AdminTransaction } from '../security/admin-mutation.service.js';

export const SUPPLIER_COPY_SOURCE_KINDS = ['PROCESS_LEDGER', 'CUSTOMER_LEDGER', 'NEW_PRODUCT_SELECTION'] as const;
export type SupplierCopySourceKind = typeof SUPPLIER_COPY_SOURCE_KINDS[number];

export interface SupplierCopySource {
  kind: SupplierCopySourceKind;
  sourceId: string;
  sourceVersion: number;
  materialItemId?: string;
}

export interface SupplierCopyMaterial {
  id: string;
  materialCode: string | null;
  materialName: string | null;
  materialBatch: string | null;
  supplierProfileId: string | null;
  supplierOrganizationId: string | null;
}

export interface SupplierCopyFact {
  factKey: string;
  defectDescription: string;
  defectQuantity: number | null;
  materials: SupplierCopyMaterial[];
}

export interface SupplierCopyProjection {
  organizationId: string;
  source: SupplierCopySource;
  facts: SupplierCopyFact[];
}

export interface SupplierCopyProjectionPort {
  supplierCopyProjection(tx: AdminTransaction, actor: AdminActor, source: SupplierCopySource): Promise<SupplierCopyProjection>;
}
