import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { ProblemDomainRegistry, PROBLEM_DOMAIN_READ_ADAPTERS } from './problem-domain-registry.js';
import { ProblemQueryService } from './problem-query.service.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { ProblemWorkspaceService } from './problem-workspace.service.js';

@Module({
  imports: [DatabaseModule, FileManagementModule],
  providers: [ProblemDomainRegistry, ProblemQueryService, ProblemWorkspaceService, { provide: PROBLEM_DOMAIN_READ_ADAPTERS, useValue: [] }],
  exports: [ProblemDomainRegistry, ProblemQueryService, ProblemWorkspaceService],
})
export class ProblemReadModule {}
