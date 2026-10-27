import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { ProblemDomainRegistry, PROBLEM_DOMAIN_READ_ADAPTERS } from './problem-domain-registry.js';
import { ProblemQueryService } from './problem-query.service.js';
import { FileManagementModule } from '../file-management/file-management.module.js';
import { ProblemWorkspaceService } from './problem-workspace.service.js';
import { SupplierProblemReadAdapter } from '../supplier-quality/supplier-problem-read.adapter.js';
import { domainProblemReadDefinition, type DomainProblemReadAdapter } from './domain-problem-read.adapter.js';

const ProcessProblemReadAdapter = domainProblemReadDefinition({ domainCode: 'process-quality', sourceType: 'process-defect', permission: 'process-quality:defects:read', label: '制程质量问题' });
const CustomerProblemReadAdapter = domainProblemReadDefinition({ domainCode: 'customer-quality', sourceType: 'customer-complaint', permission: 'customer-quality:complaints:read', label: '客户质量问题' });
const NewProductProblemReadAdapter = domainProblemReadDefinition({ domainCode: 'new-product-quality', sourceType: 'new-product-issue', permission: 'new-product-quality:projects:read', label: '新品质量问题' });
const NewProductSelectionReadAdapter = domainProblemReadDefinition({ domainCode: 'new-product-quality', sourceType: 'new-product-defect-selection', permission: 'new-product-quality:projects:read', label: '新品同源8D问题' });
const AuditProblemReadAdapter = domainProblemReadDefinition({ domainCode: 'audit-management', sourceType: 'audit-nc', permission: 'audit-management:read', label: '审核不符合项' });

@Module({
  imports: [DatabaseModule, FileManagementModule],
  providers: [ProblemDomainRegistry, ProblemQueryService, ProblemWorkspaceService, SupplierProblemReadAdapter, ProcessProblemReadAdapter, CustomerProblemReadAdapter, NewProductProblemReadAdapter, NewProductSelectionReadAdapter, AuditProblemReadAdapter,
    { provide: PROBLEM_DOMAIN_READ_ADAPTERS, useFactory: (supplier: SupplierProblemReadAdapter, process: DomainProblemReadAdapter, customer: DomainProblemReadAdapter, newProduct: DomainProblemReadAdapter, selection: DomainProblemReadAdapter, audit: DomainProblemReadAdapter) => [supplier, process, customer, newProduct, selection, audit], inject: [SupplierProblemReadAdapter, ProcessProblemReadAdapter, CustomerProblemReadAdapter, NewProductProblemReadAdapter, NewProductSelectionReadAdapter, AuditProblemReadAdapter] }],
  exports: [ProblemDomainRegistry, ProblemQueryService, ProblemWorkspaceService],
})
export class ProblemReadModule {}
