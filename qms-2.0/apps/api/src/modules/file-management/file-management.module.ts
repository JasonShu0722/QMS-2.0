import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { FileLifecycleService } from './file-lifecycle.service.js';
import { FilePolicyService } from './file-policy.service.js';
import { OBJECT_STORAGE, createObjectStorage } from './object-storage.service.js';
import { FILE_RESOURCE_ADAPTERS, FileResourceAccess } from './file-resource-access.js';
import { FileController } from './file.controller.js';
import { FileScannerService } from './file-scanner.service.js';
import { FileVerificationService } from './file-verification.service.js';
import { FileScanWorkerService } from './file-scan-worker.service.js';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  controllers: [FileController],
  providers: [
    FilePolicyService,
    FileLifecycleService,
    FileResourceAccess,
    FileScannerService,
    FileVerificationService,
    FileScanWorkerService,
    { provide: FILE_RESOURCE_ADAPTERS, useValue: [] },
    {
      provide: OBJECT_STORAGE,
      useFactory: createObjectStorage,
    },
  ],
  exports: [FilePolicyService, FileLifecycleService, FileResourceAccess, FileScanWorkerService, OBJECT_STORAGE],
})
export class FileManagementModule {}
