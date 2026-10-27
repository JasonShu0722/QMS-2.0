import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { CustomerQualityService } from './customer-quality.service.js';
import { CustomerQualityController } from './customer-quality.controller.js';
import { CustomerIssueService } from './customer-issue.service.js';
import { CustomerComplaintProcessingService } from './customer-complaint-processing.service.js';
import { ProblemIndexModule } from '../problem-index/problem-index.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { CustomerComplaintFileResourceAdapter } from './customer-complaint-file-resource.adapter.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { PlatformConfigurationModule } from '../platform-configuration/platform-configuration.module.js';
import { CustomerComplaintLedgerService } from './customer-complaint-ledger.service.js';
import { CustomerComplaintLedgerController } from './customer-complaint-ledger.controller.js';
import { CustomerComplaintAnalysisController } from './customer-complaint-analysis.controller.js';
import { CustomerComplaintAnalysisService } from './customer-complaint-analysis.service.js';
import { CustomerComplaintAnalysisFileAdapter } from './customer-complaint-analysis-file.adapter.js';
import { ProblemReadModule } from '../problem-index/problem-read.module.js';
import { TaskNotificationModule } from '../task-notification/task-notification.module.js';
import { CustomerEightDService } from './customer-eight-d.service.js';
import { CustomerEightDController } from './customer-eight-d.controller.js';
import { INTERNAL_EIGHT_D_DOMAINS } from '../../common/eight-d/internal-eight-d-domain.js';
import { CUSTOMER_EIGHT_D_RUNTIME, internalEightDRuntimeProvider, type InternalEightDRuntime } from '../../common/eight-d/internal-eight-d-runtime.js';
import { internalEightDDeliveryController } from '../../common/eight-d/internal-eight-d-delivery.controller.js';

const CustomerEightDDeliveryController = internalEightDDeliveryController(INTERNAL_EIGHT_D_DOMAINS.CUSTOMER, CUSTOMER_EIGHT_D_RUNTIME);

@Module({ imports: [AdminMutationModule, AuditLogModule, FileManagementModule, ProblemIndexModule, ProblemReadModule, WorkflowModule, OrganizationModule, PlatformConfigurationModule, TaskNotificationModule],
  controllers: [CustomerQualityController, CustomerComplaintLedgerController, CustomerComplaintAnalysisController, CustomerEightDDeliveryController, CustomerEightDController],
  providers: [CustomerQualityService, CustomerIssueService, CustomerComplaintProcessingService, CustomerComplaintFileResourceAdapter,
    CustomerComplaintLedgerService, CustomerComplaintAnalysisService, CustomerComplaintAnalysisFileAdapter,
    internalEightDRuntimeProvider(CUSTOMER_EIGHT_D_RUNTIME, CustomerComplaintLedgerService, INTERNAL_EIGHT_D_DOMAINS.CUSTOMER),
    { provide: CustomerEightDService, inject: [CUSTOMER_EIGHT_D_RUNTIME], useFactory: (runtime: InternalEightDRuntime) => new CustomerEightDService(runtime.core) }],
  exports: [CustomerQualityService, CustomerIssueService, CustomerComplaintLedgerService, CustomerEightDService, CUSTOMER_EIGHT_D_RUNTIME] })
export class CustomerQualityModule {}
