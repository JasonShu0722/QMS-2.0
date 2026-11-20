import type { AdminActor, AdminTransaction } from './security/admin-mutation.service.js';

export type MasterDataIntegrationTarget = 'SUPPLIER' | 'CUSTOMER' | 'MATERIAL' | 'COMPONENT';
export type IntegrationTarget = MasterDataIntegrationTarget | 'OPERATION' | 'PROCESS_DEFECT';

export type OperationIntegrationFields = { operationCode: string; operationName: string };

export type IntegrationFields = {
  code: string;
  name: string;
  componentNameMissing?: boolean;
  componentMaterialSnapshot?: { id: string; version: number } | null;
  contactName?: string;
  contactEmail?: string;
};

export type ProcessDefectIntegrationFields = {
  occurredAt?: string;
  productCode?: string;
  workOrderCode?: string;
  lineCode?: string;
  lineName?: string;
  operationCode?: string;
  operationName?: string;
  traceCode?: string;
  description?: string;
  externalRecordKey?: string;
  sourceObservedAt?: string;
  receiptId: string;
  rowIndex: number;
  issues?: string[];
};
export type IntegrationRecord<Fields = IntegrationFields> = { id: string; version: number; values: Fields };
export type ProcessDefectIntegrationRecord = IntegrationRecord<ProcessDefectIntegrationFields> & { protectedFields?: string[]; pendingCompletion?: boolean; pendingConfiguration?: boolean; deleted?: boolean };
export type IntegrationExpected = Pick<IntegrationRecord, 'id' | 'version'> | null;

export interface IntegrationMasterDataAdapter {
  inspect(transaction: AdminTransaction, actor: AdminActor, fields: IntegrationFields): Promise<IntegrationRecord | null>;
  write(transaction: AdminTransaction, actor: AdminActor, fields: IntegrationFields, expected: IntegrationExpected, traceId: string): Promise<IntegrationRecord>;
}
