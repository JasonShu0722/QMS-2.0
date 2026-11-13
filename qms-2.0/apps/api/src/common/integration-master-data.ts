import type { AdminActor, AdminTransaction } from './security/admin-mutation.service.js';

export type IntegrationTarget = 'SUPPLIER' | 'CUSTOMER' | 'MATERIAL' | 'COMPONENT';

export type IntegrationFields = {
  code: string;
  name: string;
  contactName?: string;
  contactEmail?: string;
};

export type IntegrationRecord = { id: string; version: number; values: IntegrationFields };
export type IntegrationExpected = Pick<IntegrationRecord, 'id' | 'version'> | null;

export interface IntegrationMasterDataAdapter {
  inspect(transaction: AdminTransaction, actor: AdminActor, fields: IntegrationFields): Promise<IntegrationRecord | null>;
  write(transaction: AdminTransaction, actor: AdminActor, fields: IntegrationFields, expected: IntegrationExpected, traceId: string): Promise<IntegrationRecord>;
}
