import { HttpException, Injectable, Optional } from '@nestjs/common';
import type { AdminActor, AdminTransaction } from '../../common/security/admin-mutation.service.js';
import type { IntegrationFields, IntegrationExpected, IntegrationMasterDataAdapter, IntegrationTarget, IntegrationRecord, MasterDataIntegrationTarget, ProcessDefectIntegrationFields, ProcessDefectIntegrationRecord } from '../../common/integration-master-data.js';
import { SupplierProfileIngestionAdapter } from '../supplier-quality/supplier-profile-ingestion.adapter.js';
import { CustomerMasterIngestionAdapter } from '../customer-quality/customer-master-ingestion.adapter.js';
import { MaterialMasterIngestionAdapter } from '../material-master/material-master-ingestion.adapter.js';
import { ComponentProjectIngestionAdapter } from '../platform-configuration/component-project-ingestion.adapter.js';
import { ProcessDefectIngestionAdapter } from '../process-quality/process-defect-ingestion.adapter.js';

export type IngestionTargetRecord = IntegrationRecord | ProcessDefectIntegrationRecord;
export type IngestionTargetFields = IntegrationFields | ProcessDefectIntegrationFields;
export type IngestionTargetResult = { id: string; pendingCompletion: boolean; pendingConfiguration: boolean; defectQuantity: number | null };

@Injectable()
export class IngestionTargetsService {
  constructor(
    private readonly suppliers: SupplierProfileIngestionAdapter,
    private readonly customers: CustomerMasterIngestionAdapter,
    private readonly materials: MaterialMasterIngestionAdapter,
    private readonly components: ComponentProjectIngestionAdapter,
    @Optional() private readonly processDefects?: ProcessDefectIngestionAdapter,
  ) {}

  inspect(transaction: AdminTransaction, actor: AdminActor, target: MasterDataIntegrationTarget, fields: IntegrationFields): Promise<IntegrationRecord | null>;
  inspect(transaction: AdminTransaction, actor: AdminActor, target: IntegrationTarget, fields: IngestionTargetFields, linkedTargetId?: string): Promise<IngestionTargetRecord | null>;
  async inspect(transaction: AdminTransaction, actor: AdminActor, target: IntegrationTarget, fields: IngestionTargetFields, linkedTargetId?: string): Promise<IngestionTargetRecord | null> {
    if (target === 'PROCESS_DEFECT' && this.processDefects) return this.processDefects.inspect(transaction, actor, fields as ProcessDefectIntegrationFields, linkedTargetId);
    return this.adapter(target).inspect(transaction, actor, fields as IntegrationFields);
  }

  write(transaction: AdminTransaction, actor: AdminActor, target: MasterDataIntegrationTarget, fields: IntegrationFields, expected: IntegrationExpected, traceId: string, confirmed?: boolean): Promise<IntegrationRecord>;
  write(transaction: AdminTransaction, actor: AdminActor, target: IntegrationTarget, fields: IngestionTargetFields, expected: IntegrationExpected, traceId: string, confirmed?: boolean): Promise<IngestionTargetRecord>;
  async write(transaction: AdminTransaction, actor: AdminActor, target: IntegrationTarget, fields: IngestionTargetFields, expected: IntegrationExpected, traceId: string, confirmed = false): Promise<IngestionTargetRecord> {
    if (target === 'PROCESS_DEFECT' && this.processDefects) return this.processDefects.write(transaction, actor, fields as ProcessDefectIntegrationFields, expected, traceId, confirmed);
    return this.adapter(target).write(transaction, actor, fields as IntegrationFields, expected, traceId);
  }

  async results(transaction: AdminTransaction, actor: AdminActor, target: IntegrationTarget, ids: string[]): Promise<IngestionTargetResult[]> {
    if (target !== 'PROCESS_DEFECT' || !ids.length) return [];
    if (this.processDefects) return this.processDefects.results(transaction, actor, ids);
    throw new HttpException({ code: 'INTEGRATION_INPUT_INVALID', message: 'INTEGRATION_INPUT_INVALID' }, 400);
  }

  private adapter(target: IntegrationTarget): IntegrationMasterDataAdapter {
    switch (target) {
      case 'SUPPLIER': return this.suppliers;
      case 'CUSTOMER': return this.customers;
      case 'MATERIAL': return this.materials;
      case 'COMPONENT': return this.components;
      default: throw new HttpException({ code: 'INTEGRATION_INPUT_INVALID', message: 'INTEGRATION_INPUT_INVALID' }, 400);
    }
  }
}
