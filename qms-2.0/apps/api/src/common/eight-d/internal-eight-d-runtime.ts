import type { Provider, Type } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditLogService } from '../../modules/audit-log/audit-log.service.js';
import { FileLifecycleService } from '../../modules/file-management/file-lifecycle.service.js';
import { FileResourceAccess } from '../../modules/file-management/file-resource-access.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../../modules/file-management/object-storage.service.js';
import { OrganizationResponsibilityService } from '../../modules/organization/organization-responsibility.service.js';
import { DomainSourceIssueService } from '../../modules/problem-index/domain-source-issue.service.js';
import { DomainSourceLinkService } from '../../modules/problem-index/domain-source-link.service.js';
import { ProblemDomainRegistry } from '../../modules/problem-index/problem-domain-registry.js';
import { ProblemIndexService } from '../../modules/problem-index/problem-index.service.js';
import { ProcessEightDService } from '../../modules/process-quality/process-eight-d.service.js';
import { ProcessEightDTaskService } from '../../modules/process-quality/process-eight-d-task.service.js';
import { ProcessEightDReminderService } from '../../modules/process-quality/process-eight-d-reminder.service.js';
import { ProcessEightDReportService } from '../../modules/process-quality/process-eight-d-report.service.js';
import type { InternalEightDSourcePort } from '../../modules/process-quality/process-eight-d.types.js';
import { OutboxService } from '../../modules/task-notification/outbox.service.js';
import { WorkflowClosureRegistry } from '../../modules/workflow/workflow-closure-registry.js';
import { WorkflowClosureRoundService } from '../../modules/workflow/workflow-closure-round.service.js';
import { WorkflowDeadlineExtensionService } from '../../modules/workflow/workflow-deadline-extension.service.js';
import { WorkflowRuntimeService } from '../../modules/workflow/workflow-runtime.service.js';
import { InternalEightDClosureAdapter, InternalEightDFileAdapter, InternalEightDReadAdapter } from './internal-eight-d-adapters.js';
import { assertInternalEightDDomain, type InternalEightDDomainDescriptor } from './internal-eight-d-domain.js';

export const CUSTOMER_EIGHT_D_RUNTIME = Symbol('CUSTOMER_EIGHT_D_RUNTIME');
export const NEW_PRODUCT_EIGHT_D_RUNTIME = Symbol('NEW_PRODUCT_EIGHT_D_RUNTIME');

export function createInternalEightDRuntime(domain: InternalEightDDomainDescriptor, prisma: PrismaService, source: InternalEightDSourcePort,
  domainIssues: DomainSourceIssueService, links: DomainSourceLinkService, runtime: WorkflowRuntimeService, problems: ProblemIndexService,
  rounds: WorkflowClosureRoundService, responsibilities: OrganizationResponsibilityService, resources: FileResourceAccess, audit: AuditLogService,
  outbox: OutboxService, readRegistry: ProblemDomainRegistry, extensions: WorkflowDeadlineExtensionService, closureRegistry: WorkflowClosureRegistry,
  files: FileLifecycleService, storage: ObjectStorage) {
  assertInternalEightDDomain(domain);
  const core = new ProcessEightDService(prisma, source, domainIssues, links, runtime, problems, rounds, responsibilities, resources, audit, outbox, readRegistry, extensions, domain);
  const reminders = new ProcessEightDReminderService(prisma, core, extensions, rounds, outbox, domain);
  const tasks = new ProcessEightDTaskService(prisma, core, extensions, rounds, reminders, domain);
  const report = new ProcessEightDReportService(prisma, core, files, storage, audit, domain);
  const closure = new InternalEightDClosureAdapter(closureRegistry, core, domain);
  const file = new InternalEightDFileAdapter(resources, core, domain);
  const read = new InternalEightDReadAdapter(readRegistry, core, domain);
  return { core, reminders, tasks, report, onModuleInit() { closure.onModuleInit(); file.onModuleInit(); read.onModuleInit(); } };
}

export type InternalEightDRuntime = ReturnType<typeof createInternalEightDRuntime>;

export function internalEightDRuntimeProvider(token: symbol, sourceToken: Type<InternalEightDSourcePort>, domain: InternalEightDDomainDescriptor): Provider {
  return { provide: token, inject: [PrismaService, sourceToken, DomainSourceIssueService, DomainSourceLinkService, WorkflowRuntimeService,
    ProblemIndexService, WorkflowClosureRoundService, OrganizationResponsibilityService, FileResourceAccess, AuditLogService, OutboxService,
    ProblemDomainRegistry, WorkflowDeadlineExtensionService, WorkflowClosureRegistry, FileLifecycleService, OBJECT_STORAGE],
  useFactory: (...args: Parameters<typeof createInternalEightDRuntime> extends [unknown, ...infer Dependencies] ? Dependencies : never) => createInternalEightDRuntime(domain, ...args) };
}
