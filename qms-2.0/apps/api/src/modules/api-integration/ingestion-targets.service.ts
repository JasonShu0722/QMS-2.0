import { HttpException, Injectable } from '@nestjs/common';
import type { AdminActor, AdminTransaction } from '../../common/security/admin-mutation.service.js';
import type { IntegrationFields, IntegrationExpected, IntegrationMasterDataAdapter, IntegrationTarget, IntegrationRecord } from '../../common/integration-master-data.js';
import { SupplierProfileIngestionAdapter } from '../supplier-quality/supplier-profile-ingestion.adapter.js';
import { CustomerMasterIngestionAdapter } from '../customer-quality/customer-master-ingestion.adapter.js';
import { MaterialMasterIngestionAdapter } from '../material-master/material-master-ingestion.adapter.js';
import { ComponentProjectIngestionAdapter } from '../platform-configuration/component-project-ingestion.adapter.js';

@Injectable()
export class IngestionTargetsService {
  constructor(
    private readonly suppliers: SupplierProfileIngestionAdapter,
    private readonly customers: CustomerMasterIngestionAdapter,
    private readonly materials: MaterialMasterIngestionAdapter,
    private readonly components: ComponentProjectIngestionAdapter,
  ) {}

  async inspect(transaction: AdminTransaction, actor: AdminActor, target: IntegrationTarget, fields: IntegrationFields): Promise<IntegrationRecord | null> {
    return this.adapter(target).inspect(transaction, actor, fields);
  }

  async write(transaction: AdminTransaction, actor: AdminActor, target: IntegrationTarget, fields: IntegrationFields, expected: IntegrationExpected, traceId: string): Promise<IntegrationRecord> {
    return this.adapter(target).write(transaction, actor, fields, expected, traceId);
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
