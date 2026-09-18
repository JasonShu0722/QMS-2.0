import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { FileLifecycleService } from './file-lifecycle.service.js';
import { FilePolicyService } from './file-policy.service.js';
import { OBJECT_STORAGE, createObjectStorage } from './object-storage.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    FilePolicyService,
    FileLifecycleService,
    {
      provide: OBJECT_STORAGE,
      useFactory: createObjectStorage,
    },
  ],
  exports: [FilePolicyService, FileLifecycleService, OBJECT_STORAGE],
})
export class FileManagementModule {}
