import { Module } from '@nestjs/common';
import { FileLifecycleService } from './file-lifecycle.service.js';
import { FilePolicyService } from './file-policy.service.js';
import { LocalMinioObjectStorage } from './object-storage.service.js';

@Module({
  providers: [FilePolicyService, FileLifecycleService, LocalMinioObjectStorage],
  exports: [FilePolicyService, FileLifecycleService, LocalMinioObjectStorage],
})
export class FileManagementModule {}
