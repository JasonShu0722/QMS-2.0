import type { IncomingConclusion } from './supplier-incoming.rules.js';

export interface MesIncomingInspectionResult {
  sourceSystem: 'MES';
  externalRecordKey: string;
  externalBatchKey: string;
  supplierExternalKey: string;
  materialCode: string;
  receivedQuantity: number;
  sampledQuantity: number;
  conclusion: IncomingConclusion;
  observedAt: Date;
  revision: number;
  payloadDigest: string;
}

export interface MesIncomingPort {
  readonly enabled: false;
  receive(_input: MesIncomingInspectionResult): Promise<{ status: 'NOT_ENABLED'; reason: 'MES_CONTRACT_PENDING' }>;
}
