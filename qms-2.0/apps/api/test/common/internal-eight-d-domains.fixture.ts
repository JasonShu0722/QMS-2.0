import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/database/prisma.service.js';
import { CUSTOMER_EIGHT_D_RUNTIME, NEW_PRODUCT_EIGHT_D_RUNTIME, type InternalEightDRuntime } from '../../src/common/eight-d/internal-eight-d-runtime.js';
import { CustomerEightDService } from '../../src/modules/customer-quality/customer-eight-d.service.js';
import { CustomerComplaintLedgerService } from '../../src/modules/customer-quality/customer-complaint-ledger.service.js';
import { NewProductEightDService } from '../../src/modules/new-product-quality/new-product-eight-d.service.js';
import { NewProductEightDSourceService } from '../../src/modules/new-product-quality/new-product-eight-d-source.service.js';
import { NewProductQualityService } from '../../src/modules/new-product-quality/new-product-quality.service.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { WorkflowClosureTemplateService } from '../../src/modules/workflow/workflow-closure-template.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { normalizeProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { createWorkflowClosureFixture } from '../workflow/workflow-closure-round.fixture.js';

export type DomainName = 'customer-quality' | 'new-product-quality';
export type Source = { sourceId: string; expectedVersion: number; factId: string };

export function completeDocument(domain: DomainName) {
  const document = normalizeProcessEightDDocument({
    description: `${domain} real source chain`, analysisProcess: 'Compare the measured process and inspection records',
    temporaryMeasures: [{ id: 'isolate', description: 'Isolate the affected stock', departmentOwner: 'Actual section', introducedAt: '2026-10-27' }],
    containment: [{ id: 'stock', group: 'In-house stock', location: 'Actual stock area', quantity: 10, ngQuantity: 1,
      measure: 'Inspect all ten pieces', owner: 'Actual owner', plannedAt: '2026-10-27', completion: 'Ten inspected, one isolated' }],
    occurrenceCause: 'Measured occurrence cause', escapeCause: 'Measured escape cause',
    correctiveActions: (['OCCURRENCE', 'ESCAPE'] as const).map((causeKind, i) => ({
      id: `action-${i}`, causeKind, action: 'Implement verified countermeasure', owner: 'Actual owner', plannedAt: '2026-10-27',
      verificationMethod: 'Measure against the original acceptance criteria', implementationAt: '2026-10-27', result: 'Implemented',
      beforeState: 'Nonconforming', afterState: 'Conforming', firstBatch: `REAL-${i}`, followUpBatchCount: 3,
      verificationRecord: 'Three actual batches conform', effective: true,
    })),
    horizontalDeployment: [{ id: 'related', scope: 'Related product and process', inspectionResult: 'Same exposure checked',
      action: 'Apply the verified inspection control', owner: 'Actual owner', completion: 'Related line verified' }],
    closureSummary: 'Actual occurrence and escape measures verified; both independent duties must approve closure',
  });
  for (const row of document.standardization) {
    row.needsUpdate = false; row.status = 'NOT_APPLICABLE'; row.reason = 'Controlled document reviewed; no change required for this fixture';
  }
  return document;
}

export async function domainFixture(app: INestApplication, domain: DomainName) {
  const prisma = app.get(PrismaService), rounds = app.get(WorkflowClosureRoundService);
  // Reuse real appointments and manager/minister bindings, not its neutral closure adapter.
  const f = await createWorkflowClosureFixture(prisma, rounds);
  await prisma.session.updateMany({ where: { userId: { in: [f.owner.user.id, f.professional.user.id, f.manager.user.id, f.minister.user.id] } },
    data: { reauthenticatedAt: new Date() } });
  const customer = app.get(CustomerComplaintLedgerService), process = app.get(ProcessDefectLedgerService);
  const quality = app.get(NewProductQualityService), mappings = app.get(ComponentProjectService);
  const runtime = app.get<InternalEightDRuntime>(domain === 'customer-quality' ? CUSTOMER_EIGHT_D_RUNTIME : NEW_PRODUCT_EIGHT_D_RUNTIME);
  const service = domain === 'customer-quality' ? app.get(CustomerEightDService) : app.get(NewProductEightDService);
  const codes = ['configuration:read', 'configuration:manage', 'workflow:manage', 'workflow:start', 'task:read', 'notification:read',
    'component-project:read', 'component-project:manage', 'process-quality:defects:read', 'process-quality:defects:write',
    'customer-quality:complaints:read', 'customer-quality:complaints:write',
    'new-product-quality:projects:read', 'new-product-quality:projects:write',
    ...(['customer-quality', 'new-product-quality'] as const).flatMap(d =>
      ['read', 'work', 'issue', 'report', 'sources', 'risk', 'reassign', 'deadlines'].map(action => `${d}:issues:${action}`))];
  const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
  expect(permissions).toHaveLength(codes.length);
  await prisma.rolePermission.createMany({ data: permissions.map(p => ({ roleId: f.role.id, permissionId: p.id })), skipDuplicates: true });
  await app.get(NumberingService).publishRuleVersion({ organizationId: f.org.id, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
  const template = await app.get(WorkflowClosureTemplateService).initialize(f.professional.actor,
    { policy: 'INTERNAL', domainCode: domain, code: randomUUID(), name: `Real ${domain} chain` }, randomUUID(), randomUUID());
  const published = await app.get(WorkflowDefinitionService).publishVersion({ organizationId: f.org.id, userId: f.professional.user.id,
    actor: f.professional.actor, definitionId: template.id, expectedRevision: template.revision, draftVersionId: template.version.id });
  await service.bind(f.professional.actor, { expectedVersion: 0, workflowDefinitionId: template.id, workflowVersionId: published.id }, randomUUID(), randomUUID());
  await service.activate(f.professional.actor, { expectedVersion: 1, enabled: true }, randomUUID(), randomUUID());
  const productCode = `COMP-${randomUUID()}`;
  const project = await quality.createProject(f.professional.actor,
    { code: `NP-${randomUUID()}`, name: 'Actual same-fact project', productCode }, randomUUID(), randomUUID());
  const projectRecord = await mappings.createProject(f.professional.actor, f.org.id,
    { code: project.code, name: 'Mapped project', stage: 'NEW_PRODUCT', projectEngineerAssignmentId: f.owner.assignment.id }, randomUUID(), randomUUID());
  await mappings.createMapping(f.professional.actor, f.org.id,
    { componentCode: productCode, projectRecordId: projectRecord.id, productCategory: 'controller' }, randomUUID(), randomUUID());

  async function source(): Promise<Source> {
    if (domain === 'customer-quality') {
      const row = await customer.create(f.manager.actor, { fields: { complaintType: 'AFTER_SALES', componentCode: productCode,
        defectDescription: 'Original unanalysed customer fact', customerName: `Customer ${randomUUID()}` } }, randomUUID(), randomUUID());
      return { sourceId: row.id, expectedVersion: row.version, factId: row.id };
    }
    const row = await process.create(f.manager.actor, { description: 'Original unanalysed process fact', productCode }, randomUUID(), randomUUID());
    const selection = await quality.selectProcessDefect(f.professional.actor, project.id,
      { defectId: row.id, expectedVersion: row.version }, randomUUID(), randomUUID());
    return { sourceId: String(selection.id), expectedVersion: row.version, factId: row.id };
  }
  const input = (sources: Source[]) => ({ sources: sources.map(({ sourceId, expectedVersion }) => ({ sourceId, expectedVersion })),
    severity: 'LOW' as const, ownerUserId: f.owner.user.id, responsibleSectionDepartmentId: f.section.id,
    analysisDueAt: new Date('2026-11-01T00:00:00Z'), closureDueAt: new Date('2026-12-01T00:00:00Z') });
  const issue = async (sources: Source[]) => String((await service.issue(f.professional.actor, input(sources), randomUUID(), randomUUID())).problem.id);
  const read = (id: string) => service.read(f.owner.actor, id);
  const reference = (s: Source) => domain === 'customer-quality' ? customer.sourceReference(f.professional.actor, s.sourceId)
    : app.get(NewProductEightDSourceService).sourceReference(f.professional.actor, s.sourceId);
  const chainSource = await source(), matrixSources = [await source(), await source()], extra = await source(), archived = await source();
  if (domain === 'customer-quality') await prisma.customerQualityComplaint.update({ where: { id: archived.factId }, data: { archivedAt: new Date() } });
  else await prisma.processDefect.update({ where: { id: archived.factId }, data: { archivedAt: new Date() } });
  const ungranted = await f.person(f.section.id);
  await prisma.userRole.deleteMany({ where: { userId: ungranted.user.id } });
  const supplierOrg = await prisma.organization.create({ data: { code: randomUUID(), name: 'Actual supplier scope', type: 'SUPPLIER' } });
  const supplierUser = await prisma.user.create({ data: { organizationId: supplierOrg.id, username: randomUUID(), passwordHash: 'unused', accountType: 'SUPPLIER' } });
  const supplierSession = await prisma.session.create({ data: { userId: supplierUser.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
  const supplier = { id: supplierUser.id, sessionId: supplierSession.id, organizationId: supplierOrg.id, accountType: 'SUPPLIER' as const };
  return { ...f, domain, prisma, rounds, runtime, service, customer, process, quality, mappings, project, projectRecord, productCode,
    source, input, issue, read, reference, chainSource, matrixSources, extra, archived, ungranted, supplier,
    workflowBinding: { workflowDefinitionId: template.id, workflowVersionId: published.id, instanceKey: randomUUID() } };
}

export type DomainFixture = Awaited<ReturnType<typeof domainFixture>>;
