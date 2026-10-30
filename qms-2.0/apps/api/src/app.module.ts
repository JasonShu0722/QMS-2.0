import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { AdministrativeLifecycleModule, AdministrativeLifecycleRegistry } from './common/security/administrative-lifecycle.registry.js';
import { AdministrativeReconfigurationController } from './administrative-reconfiguration.controller.js';
import { AdministrativeProblemReconfigurationController } from './administrative-problem-reconfiguration.controller.js';
import { AdministrativeProblemReconfigurationService } from './administrative-problem-reconfiguration.service.js';
import { AdminMutationModule } from './common/security/admin-mutation.service.js';
import { DatabaseModule } from './database/database.module.js';
import { AuditLogModule } from './modules/audit-log/audit-log.module.js';
import { AuditQueryModule } from './modules/audit-log/audit-query.module.js';
import { PlatformConfigurationModule } from './modules/platform-configuration/platform-configuration.module.js';
import { AuthorizationModule } from './modules/authorization/authorization.module.js';
import { FileManagementModule } from './modules/file-management/file-management.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { TaskNotificationModule } from './modules/task-notification/task-notification.module.js';
import { ReportingModule } from './modules/reporting/reporting.module.js';
import { ProblemIndexModule } from './modules/problem-index/problem-index.module.js';
import { ProblemSavedViewModule } from './modules/problem-index/problem-saved-view.module.js';
import { WorkflowModule } from './modules/workflow/workflow.module.js';
import { APPLICATION_OUTBOX_HANDLER, type AtomicOutboxHandler } from './modules/task-notification/outbox-worker.service.js';
import { WorkflowEventHandler } from './modules/task-notification/workflow-event.handler.js';
import { ClosureEventHandler } from './modules/task-notification/closure-event.handler.js';
import { SupplierQualityModule } from './modules/supplier-quality/supplier-quality.module.js';
import { SupplierEightDSourceModule } from './modules/supplier-eight-d-source/supplier-eight-d-source.module.js';
import { SupplierEightDReminderService } from './modules/supplier-quality/supplier-eight-d-reminder.service.js';
import { ProcessQualityModule } from './modules/process-quality/process-quality.module.js';
import { ProcessEightDReminderService } from './modules/process-quality/process-eight-d-reminder.service.js';
import { CustomerQualityModule } from './modules/customer-quality/customer-quality.module.js';
import { MaterialMasterModule } from './modules/material-master/material-master.module.js';
import { AuditManagementModule } from './modules/audit-management/audit-management.module.js';
import { NewProductQualityModule } from './modules/new-product-quality/new-product-quality.module.js';
import { QualityDataModule } from './modules/quality-data/quality-data.module.js';
import { SupplierIncomingModule } from './modules/supplier-incoming/supplier-incoming.module.js';
import { CoordinateInspectionModule } from './modules/coordinate-inspection/coordinate-inspection.module.js';
import { SupplierPerformanceModule } from './modules/supplier-performance/supplier-performance.module.js';
import { SupplierConcessionModule } from './modules/supplier-concession/supplier-concession.module.js';
import { AnnouncementModule } from './modules/announcements/announcement.module.js';
import { AuditStandardsModule } from './modules/audit-standards/audit-standards.module.js';
import { SupplierAdmissionModule } from './modules/supplier-admission/supplier-admission.module.js';
import { ESignatureModule } from './modules/e-signature/e-signature.module.js';
import { SupplierAuditModule } from './modules/supplier-audit/supplier-audit.module.js';
import { SupplierQualityTargetsModule } from './modules/supplier-quality-targets/supplier-quality-targets.module.js';
import { SupplierMeetingsModule } from './modules/supplier-meetings/supplier-meetings.module.js';
import { SupplierPpapModule } from './modules/supplier-ppap/supplier-ppap.module.js';
import { SupplierInspectionStandardsModule } from './modules/supplier-inspection-standards/supplier-inspection-standards.module.js';
import { SupplierBarcodeModule } from './modules/supplier-barcode/supplier-barcode.module.js';
import { SupplierAsnModule } from './modules/supplier-asn/supplier-asn.module.js';
import { SupplierPcnModule } from './modules/supplier-pcn/supplier-pcn.module.js';
import { CUSTOMER_EIGHT_D_RUNTIME, NEW_PRODUCT_EIGHT_D_RUNTIME, type InternalEightDRuntime } from './common/eight-d/internal-eight-d-runtime.js';
import { internalEightDReminderHandler } from './common/eight-d/internal-eight-d-reminder.js';
import { SystemManagementModule } from './modules/system-management/system-management.module.js';

@Module({
  controllers: [AdministrativeReconfigurationController, AdministrativeProblemReconfigurationController],
  providers: [AdministrativeProblemReconfigurationService, { provide: APPLICATION_OUTBOX_HANDLER, inject: [WorkflowEventHandler, ClosureEventHandler, ProcessEightDReminderService, CUSTOMER_EIGHT_D_RUNTIME, NEW_PRODUCT_EIGHT_D_RUNTIME, SupplierEightDReminderService],
    useFactory: (legacy: WorkflowEventHandler, closure: ClosureEventHandler, process: ProcessEightDReminderService, customer: InternalEightDRuntime, newProduct: InternalEightDRuntime, supplier: SupplierEightDReminderService): AtomicOutboxHandler =>
      internalEightDReminderHandler([process, customer.reminders, newProduct.reminders, supplier, closure, legacy]) }],
  imports: [
    AdministrativeLifecycleModule,
    AdminMutationModule,
    DatabaseModule,
    IdentityModule,
    OrganizationModule,
    AuthorizationModule,
    AuditLogModule,
    AuditQueryModule,
    PlatformConfigurationModule,
    FileManagementModule,
    TaskNotificationModule,
    SystemManagementModule,
    ReportingModule,
    ProblemIndexModule,
    ProblemSavedViewModule,
    WorkflowModule,
    SupplierQualityModule,
    SupplierEightDSourceModule,
    ProcessQualityModule,
    CustomerQualityModule,
    MaterialMasterModule,
    AuditManagementModule,
    NewProductQualityModule,
    QualityDataModule,
    SupplierIncomingModule,
    CoordinateInspectionModule,
    SupplierPerformanceModule,
    SupplierConcessionModule,
    AnnouncementModule,
    AuditStandardsModule,
    SupplierAdmissionModule,
    ESignatureModule,
    SupplierAuditModule,
    SupplierQualityTargetsModule,
    SupplierMeetingsModule,
    SupplierPpapModule,
    SupplierInspectionStandardsModule,
    SupplierBarcodeModule,
    SupplierAsnModule,
    SupplierPcnModule,
  ],
})
export class AppModule implements OnApplicationBootstrap {
  constructor(private readonly administrativeLifecycle: AdministrativeLifecycleRegistry) {}
  onApplicationBootstrap() { this.administrativeLifecycle.seal(); }
}
