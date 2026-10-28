import { Module } from '@nestjs/common';
import { AdminMutationModule } from '../../common/security/admin-mutation.service.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { NewProductFileResourceAdapter } from './new-product-file-resource.adapter.js';
import { NewProductQualityController } from './new-product-quality.controller.js';
import { NewProductQualityService } from './new-product-quality.service.js';
import { ProblemIndexModule } from '../problem-index/problem-index.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { NewProductQualityUpgradeAdapter } from './new-product-quality-upgrade.adapter.js';
import { NewProductEightDSourceService } from './new-product-eight-d-source.service.js';
import { NewProductEightDService } from './new-product-eight-d.service.js';
import { NewProductEightDController } from './new-product-eight-d.controller.js';
import { ProblemReadModule } from '../problem-index/problem-read.module.js';
import { TaskNotificationModule } from '../task-notification/task-notification.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { PlatformConfigurationModule } from '../platform-configuration/platform-configuration.module.js';
import { ProcessQualityModule } from '../process-quality/process-quality.module.js';
import { INTERNAL_EIGHT_D_DOMAINS } from '../../common/eight-d/internal-eight-d-domain.js';
import { NEW_PRODUCT_EIGHT_D_RUNTIME, internalEightDRuntimeProvider, type InternalEightDRuntime } from '../../common/eight-d/internal-eight-d-runtime.js';
import { internalEightDDeliveryController } from '../../common/eight-d/internal-eight-d-delivery.controller.js';

const NewProductEightDDeliveryController = internalEightDDeliveryController(INTERNAL_EIGHT_D_DOMAINS.NEW_PRODUCT, NEW_PRODUCT_EIGHT_D_RUNTIME);

@Module({
  imports: [AdminMutationModule, AuditLogModule, FileManagementModule, ProblemIndexModule, ProblemReadModule, WorkflowModule,
    TaskNotificationModule, OrganizationModule, PlatformConfigurationModule, ProcessQualityModule],
  controllers: [NewProductQualityController, NewProductEightDDeliveryController, NewProductEightDController],
  providers: [NewProductQualityService, NewProductFileResourceAdapter, NewProductQualityUpgradeAdapter, NewProductEightDSourceService,
    internalEightDRuntimeProvider(NEW_PRODUCT_EIGHT_D_RUNTIME, NewProductEightDSourceService, INTERNAL_EIGHT_D_DOMAINS.NEW_PRODUCT),
    { provide: NewProductEightDService, inject: [NEW_PRODUCT_EIGHT_D_RUNTIME], useFactory: (runtime: InternalEightDRuntime) => new NewProductEightDService(runtime.core) }],
  exports: [NewProductQualityService, NewProductEightDService, NewProductEightDSourceService, NEW_PRODUCT_EIGHT_D_RUNTIME],
})
export class NewProductQualityModule {}
