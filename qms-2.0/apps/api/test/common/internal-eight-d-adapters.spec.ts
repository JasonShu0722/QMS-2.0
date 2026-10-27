import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client.js';
import { INTERNAL_EIGHT_D_DOMAINS as domains, type InternalEightDDomainDescriptor } from '../../src/common/eight-d/internal-eight-d-domain.js';
import { internalEightDSections } from '../../src/common/eight-d/internal-eight-d-sections.js';
import { DomainProblemReadAdapter } from '../../src/modules/problem-index/domain-problem-read.adapter.js';
import { ProblemDomainRegistry } from '../../src/modules/problem-index/problem-domain-registry.js';
import type { ProblemDomainReport } from '../../src/modules/problem-index/problem-domain-registry.js';
import { ReportingService } from '../../src/modules/reporting/reporting.service.js';
import type { ProblemReportDto } from '../../src/modules/reporting/reporting.dto.js';
import { WorkflowClosureRegistry } from '../../src/modules/workflow/workflow-closure-registry.js';
import { FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import type { ProcessEightDRecord } from '../../src/modules/process-quality/process-eight-d.types.js';
import type { WorkflowClosureContext } from '../../src/modules/workflow/workflow-closure-round.types.js';

const modulePath = '../../src/common/eight-d/internal-eight-d-adapters.js';
let implementation: typeof import('../../src/common/eight-d/internal-eight-d-adapters.js') | null;
beforeAll(async () => { implementation = await import(modulePath).catch(() => null); });

function setup(domain: InternalEightDDomainDescriptor = domains.CUSTOMER) {
  expect(implementation).not.toBeNull();
  const actor = { id: randomUUID(), organizationId: randomUUID(), accountType: 'INTERNAL' as const, sessionId: randomUUID(), scopeOrganizationId: randomUUID() };
  const organizationId = randomUUID(), problemId = randomUUID(), ownerUserId = randomUUID(), sectionId = randomUUID();
  const context = { organizationId, problemId, instanceId: randomUUID(), workflowVersionId: randomUUID(),
    ownerUserId, professionalUserId: randomUUID(), responsibleSectionDepartmentId: sectionId } as WorkflowClosureContext;
  const document: ProcessEightDRecord['report']['document'] = { ...emptyProcessEightDDocument(), description: 'Current description', okFileIds: [randomUUID()] };
  const record = { problem: { id: problemId, organizationId, domainCode: domain.domainCode, sourceType: domain.sourceType, sourceId: randomUUID(),
    problemType: domain.problemType, reportNumber: '8D-001', status: 'IN_PROGRESS', version: 2, updatedAt: new Date(), ownerId: ownerUserId },
    report: { document, version: 7, responsibleSectionDepartmentId: sectionId, closedRevisionId: null, updatedAt: new Date(),
      analysisDueAt: null, submissionDueAt: null, closureDueAt: null, analysisCompletedAt: null, submittedAt: null },
    instance: { id: context.instanceId, workflowVersionId: context.workflowVersionId, version: 4, status: 'RUNNING' }, node: { config: {} },
  } as unknown as ProcessEightDRecord;
  const snapshot = { problem: record.problem, instance: record.instance, document };
  const revisionRows = [{ id: randomUUID() }];
  const service = {
    domain, closureContext: jest.fn(async () => context), complete: jest.fn(async () => {}), returnForChanges: jest.fn(async () => {}),
    canNotifyClosureRecipient: jest.fn(async () => false), lockRecord: jest.fn(async () => record),
    authorizeRead: jest.fn(async () => {}), authorizeEdit: jest.fn(async () => {}), authorizeDeadlineRequest: jest.fn(async () => {}),
    deadlineContext: jest.fn(async () => context), notificationContext: jest.fn(async (): Promise<typeof context | null> => context),
    applyApprovedDeadlineExtension: jest.fn(async () => {}), readResourceOrganizationId: jest.fn(async () => organizationId),
    visibilityPredicate: jest.fn((_actor: unknown, _org: unknown, legacy: Prisma.Sql) => legacy), hasReport: jest.fn(async () => true),
    readReport: jest.fn(async () => ({ record, revision: null as { id: string; recordedAt: Date } | null, snapshot })),
    revisions: jest.fn(async () => revisionRows), allowedActions: jest.fn(async () => ['read', 'save', 'sources']),
  };
  const names = [{ kind: 'owner', id: ownerUserId, name: 'Owner' }, { kind: 'section', id: sectionId, name: 'Section' }];
  const permissionQueries: Prisma.Sql[] = [];
  const tx = { user: { findUnique: jest.fn(async () => ({ id: actor.id, organizationId: actor.organizationId, accountType: actor.accountType,
      status: 'ACTIVE', organization: { status: 'ACTIVE' } })) }, organization: { findUnique: jest.fn(async () => ({ status: 'ACTIVE' })) },
    $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
      if (sql.sql.includes(' AS allowed')) { permissionQueries.push(sql); return [{ allowed: true }]; }
      return names;
    }) };
  const registry = new ProblemDomainRegistry([new DomainProblemReadAdapter({ domainCode: domain.domainCode, sourceType: domain.sourceType,
    permission: domain.sourceReadPermission, label: 'Fallback' })]);
  const closureRegistry = new WorkflowClosureRegistry([]), resources = new FileResourceAccess([]);
  const closure = new implementation!.InternalEightDClosureAdapter(closureRegistry, service as never, domain);
  const file = new implementation!.InternalEightDFileAdapter(resources, service as never, domain);
  const read = new implementation!.InternalEightDReadAdapter(registry, service as never, domain);
  const readContext = { actor, problem: record.problem, purpose: 'overview' as const };
  return { actor, organizationId, problemId, context, record, snapshot, revisionRows, service, tx, names, permissionQueries, registry, closureRegistry, resources, closure, file, read, readContext };
}

function reportingConsumer(f: ReturnType<typeof setup>) {
  const instance = { ...f.record.instance, currentNodeId: randomUUID(), createdAt: new Date() };
  const problem = { ...f.record.problem, workflowInstanceId: instance.id };
  const context = { ...f.readContext, problem, purpose: 'report' as const };
  const tx = { ...f.tx,
    workflowMutation: { findFirst: jest.fn(async () => ({ response: { instanceId: instance.id, workflowVersionId: instance.workflowVersionId,
      version: instance.version, currentNodeId: instance.currentNodeId, status: instance.status } })) },
    workflowNode: { findFirst: jest.fn(async () => ({ id: instance.currentNodeId })) },
  };
  const prisma = { $transaction: jest.fn(async (callback: (tx: unknown) => Promise<ProblemReportDto>) => callback(tx)) };
  const problems = {
    authorized: jest.fn(async () => {
      await f.read.authorizeRead(tx as never, context);
      return { problem, adapter: f.read, context };
    }),
    authenticate: jest.fn(async () => {}),
  };
  const workspaces = {
    selectInstance: jest.fn(async () => instance), history: jest.fn(async () => ({ upgrades: [] })),
    nodeFacts: jest.fn(async (): Promise<Pick<ProblemReportDto, 'nodes' | 'workflowActions'>> => ({ nodes: [], workflowActions: [] })),
    evidence: jest.fn(async () => []),
  };
  const reporting = new ReportingService(prisma as never, problems as never, workspaces as never);
  return { tx, problems, workspaces, report: () => reporting.report(f.actor, f.organizationId, f.problemId, {}) };
}

describe.each([domains.CUSTOMER, domains.NEW_PRODUCT])('$domainCode real ReportingService consumer', domain => {
  it.each(['eight-d', 'legacy'] as const)('returns UNAVAILABLE without an immutable revision in the %s branch', async branch => {
    const f = setup(domain);
    f.service.hasReport.mockResolvedValue(branch === 'eight-d');
    const consumer = reportingConsumer(f);
    await expect(consumer.report()).resolves.toMatchObject({ revision: null, summary: null, snapshot: null,
      sections: [], evidence: [], dataAvailability: 'UNAVAILABLE',
      unavailableFields: ['problemType', 'severity', 'status', 'responsibleParty', 'ownerId', 'dueAt'] });
    expect(consumer.problems.authenticate).toHaveBeenCalledWith(consumer.tx, f.actor, f.organizationId);
    expect(consumer.tx.workflowMutation.findFirst).not.toHaveBeenCalled();
    expect(consumer.tx.workflowNode.findFirst).not.toHaveBeenCalled();
    expect(consumer.workspaces.evidence).not.toHaveBeenCalled();
    if (branch === 'eight-d') {
      expect(f.service.readReport).toHaveBeenCalledWith(consumer.tx, { ...f.actor, scopeOrganizationId: f.organizationId }, f.problemId);
      expect(await f.read.readWorkspace(f.tx as never, f.readContext, f.record.instance)).toMatchObject({ revisionId: null,
        sections: internalEightDSections(f.record.report.document) });
    } else {
      expect(f.service.readReport).not.toHaveBeenCalled();
      expect(f.permissionQueries.length).toBeGreaterThan(0);
      for (const query of f.permissionQueries) expect(query.values).toContain(domain.sourceReadPermission);
    }
  });

  it.each(['eight-d', 'legacy'] as const)('retains an actual UUID revision through the %s branch and consumer validation', async branch => {
    const f = setup(domain), revision = { id: randomUUID(), recordedAt: new Date() };
    const pinned: ProblemDomainReport = { revisionId: revision.id, instanceId: f.record.instance.id, instanceVersion: f.record.instance.version,
      recordedAt: revision.recordedAt.toISOString(), summary: { title: '8D-001', description: 'Pinned description', domainUiKey: domain.resourceType },
      snapshot: { problemType: domain.problemType, severity: 'HIGH', status: 'CLOSED', responsibleParty: null, ownerId: f.record.problem.ownerId, dueAt: null },
      sections: internalEightDSections({ ...f.record.report.document, description: 'Pinned description' }) };
    f.service.hasReport.mockResolvedValue(branch === 'eight-d');
    f.service.readReport.mockResolvedValue({ record: f.record, revision, snapshot: { ...f.snapshot,
      problem: { ...f.record.problem, severity: 'HIGH', status: 'CLOSED', responsibleParty: null, dueAt: null },
      document: { ...f.record.report.document, description: 'Pinned description' } } });
    const legacy = branch === 'legacy' ? jest.spyOn(DomainProblemReadAdapter.prototype, 'readReport').mockResolvedValue(pinned) : null;
    try {
      const consumer = reportingConsumer(f);
      await expect(consumer.report()).resolves.toMatchObject({ revision: { id: revision.id, instanceVersion: pinned.instanceVersion,
        recordedAt: pinned.recordedAt }, summary: pinned.summary, snapshot: pinned.snapshot, sections: pinned.sections, dataAvailability: 'AVAILABLE' });
      expect(consumer.tx.workflowMutation.findFirst).toHaveBeenCalledTimes(1);
      expect(consumer.tx.workflowNode.findFirst).toHaveBeenCalledTimes(1);
      expect(consumer.workspaces.evidence).toHaveBeenCalledWith(consumer.tx, f.read, expect.objectContaining({ purpose: 'report' }), revision.id);
      expect(consumer.problems.authenticate).toHaveBeenCalledTimes(1);
      if (legacy) expect(legacy).toHaveBeenCalledWith(consumer.tx, expect.objectContaining({ purpose: 'report' }), expect.objectContaining({ id: pinned.instanceId }));
    } finally {
      legacy?.mockRestore();
    }
  });
});

describe.each(Object.values(domains))('$domainCode bounded adapters', domain => {
  it('binds fixed metadata and explicitly registers lifecycle hooks without Nest injection metadata', () => {
    const f = setup(domain);
    expect(f.closure.domainCode).toBe(domain.domainCode);
    expect(f.file.resourceType).toBe(domain.resourceType);
    expect(f.read).toMatchObject({ domainCode: domain.domainCode, sourceType: domain.sourceType, revisionResourceType: domain.revisionType });
    expect(f.closureRegistry.hasDomain(domain.domainCode)).toBe(false);
    expect(f.registry.forProblem(f.record.problem)).not.toBe(f.read);
    f.closure.onModuleInit(); f.file.onModuleInit(); f.read.onModuleInit();
    expect(f.closureRegistry.get(domain.domainCode)).toBe(f.closure);
    expect(f.registry.forProblem(f.record.problem)).toBe(f.read);
    for (const adapter of [f.closure, f.file, f.read]) {
      expect(Reflect.getMetadata('__injectable__', adapter.constructor)).toBeUndefined();
      expect(Reflect.getMetadata('design:paramtypes', adapter.constructor)).toBeUndefined();
    }
    expect(() => f.file.onModuleInit()).toThrow('FILE_RESOURCE_ADAPTER_DUPLICATE');
  });

  it('uses only its fixed report table for EIGHT_D and BRIEF response form predicates', () => {
    const { read } = setup(domain);
    for (const form of ['EIGHT_D', 'BRIEF'] as const) {
      const sql = read.responseFormPredicate(form);
      expect(sql.sql).toContain(`FROM ${domain.storagePrefix}_reports`);
      expect(sql.sql).toContain('eight_d.organization_id = p.organization_id AND eight_d.problem_id = p.id');
      expect(sql.sql.startsWith('NOT ')).toBe(form === 'BRIEF');
      for (const other of Object.values(domains).filter(d => d !== domain)) expect(sql.sql).not.toContain(`${other.storagePrefix}_reports`);
      expect(sql.values).toEqual([]);
    }
  });

  it('delegates closure, parallel finalization, return and notify with the actual actor and transaction', async () => {
    const f = setup(domain);
    for (const operation of ['READ', 'SUBMIT', 'DECIDE', 'CANCEL'] as const) {
      expect(await f.closure.lockAndRead(f.tx as never, f.actor, f.problemId, operation)).toBe(f.context);
      expect(f.service.closureContext).toHaveBeenLastCalledWith(f.tx, f.actor, f.problemId, operation);
    }
    await f.closure.complete(f.tx as never, f.context, f.actor);
    await f.closure.returnForChanges(f.tx as never, f.context, f.actor);
    expect(f.service.complete).toHaveBeenCalledWith(f.tx, f.context, f.actor);
    expect(f.service.returnForChanges).toHaveBeenCalledWith(f.tx, f.context, f.actor);
    expect(await f.closure.canNotifyRecipient(f.tx as never, f.context, f.actor.id)).toBe(false);
    expect(f.service.canNotifyClosureRecipient).toHaveBeenCalledWith(f.tx, f.context, f.actor.id);
    f.service.complete.mockRejectedValueOnce(new HttpException('stale parallel round', 409));
    await expect(f.closure.complete(f.tx as never, f.context, f.actor)).rejects.toMatchObject({ status: 409 });
  });

  it('derives READ file scope from persisted resources, retaining the real cross-organization actor', async () => {
    const f = setup(domain), original = { ...f.actor }, ref = { resourceType: domain.resourceType, resourceId: f.problemId };
    expect(await f.file.authorizeAndLock(f.tx as never, f.actor, ref, 'read')).toEqual({ organizationId: f.organizationId, version: 7 });
    const reader = { ...f.actor, scopeOrganizationId: f.organizationId };
    expect(f.service.readResourceOrganizationId).toHaveBeenCalledWith(f.tx, f.problemId);
    expect(f.service.lockRecord).toHaveBeenCalledWith(f.tx, reader, f.problemId, 'READ');
    expect(f.service.authorizeRead).toHaveBeenCalledWith(f.tx, reader, f.record);
    expect(f.actor).toEqual(original);
    f.service.authorizeRead.mockRejectedValueOnce(new HttpException('denied', 403));
    await expect(f.file.authorizeAndLock(f.tx as never, f.actor, ref, 'read')).rejects.toMatchObject({ status: 403 });
  });

  it.each(['upload', 'complete', 'attach', 'delete'] as const)('preserves EDIT scope and evidence lock for %s', async action => {
    const f = setup(domain), ref = { resourceType: domain.resourceType, resourceId: f.problemId };
    await f.file.authorizeAndLock(f.tx as never, f.actor, ref, action);
    expect(f.service.readResourceOrganizationId).not.toHaveBeenCalled();
    expect(f.service.lockRecord).toHaveBeenCalledWith(f.tx, f.actor, f.problemId, 'EDIT');
    expect(f.service.authorizeEdit).toHaveBeenCalledWith(f.tx, f.actor, f.record);
    f.service.authorizeEdit.mockRejectedValueOnce(new HttpException('closed', 409));
    await expect(f.file.authorizeAndLock(f.tx as never, f.actor, ref, action)).rejects.toMatchObject({ status: 409 });
  });

  it('rejects wrong file domains and malformed IDs before accessing the core', async () => {
    const f = setup(domain);
    for (const ref of [{ resourceType: domain.resourceType, resourceId: 'invalid' }, { resourceType: 'other-eight-d', resourceId: f.problemId }]) {
      await expect(f.file.authorizeAndLock(f.tx as never, f.actor, ref, 'read')).rejects.toMatchObject({ status: 403 });
    }
    expect(f.service.readResourceOrganizationId).not.toHaveBeenCalled(); expect(f.service.lockRecord).not.toHaveBeenCalled();
  });

  it('uses the domain source permission only for controlled fallback visibility/read, not legacy private tables', async () => {
    const f = setup(domain); f.service.hasReport.mockResolvedValue(false);
    const visibility = f.read.visibilityPredicate(f.actor, f.organizationId);
    expect(visibility.values).toContain(domain.sourceReadPermission);
    expect(visibility.sql).not.toMatch(/new_product_issues|customer_complaints|process_defects/);
    expect(f.service.visibilityPredicate).toHaveBeenCalledWith(f.actor, f.organizationId, visibility);
    await f.read.authorizeRead(f.tx as never, f.readContext);
    const workspace = await f.read.readWorkspace(f.tx as never, f.readContext, null);
    expect(workspace?.sections.map(s => s.key)).toEqual(['problemFacts']);
    expect(workspace?.summary.domainUiKey).toBe(domain.domainCode);
    const report = await f.read.readReport(f.tx as never, f.readContext, f.record.instance);
    expect(report).toBeNull();
    expect(await f.read.listRevisionIds(f.tx as never, f.readContext)).toEqual([]);
    expect(await f.read.listEvidenceReferences(f.tx as never, f.readContext, null)).toEqual([]);
    expect(await f.read.describeActions(f.tx as never, f.readContext)).toEqual([]);
    expect((await f.read.readSummaries(f.tx as never, f.actor, [f.record.problem])).get(f.problemId)?.domainUiKey).toBe(domain.domainCode);
    expect(f.permissionQueries.length).toBeGreaterThan(0);
    for (const query of f.permissionQueries) expect(query.values).toContain(domain.sourceReadPermission);
    expect(f.service.lockRecord).not.toHaveBeenCalled(); expect(f.service.readReport).not.toHaveBeenCalled();
    expect(f.tx.$queryRaw.mock.calls.every(([sql]: [Prisma.Sql]) => !sql.sql.includes('_issues') && !sql.sql.includes('_reports'))).toBe(true);
    f.tx.$queryRaw.mockResolvedValueOnce([{ allowed: false }]);
    await expect(f.read.readWorkspace(f.tx as never, f.readContext, null)).rejects.toMatchObject({ status: 403 });
  });

  it('delegates authorized READ, bounded list fields, sections, revisions, file and action metadata', async () => {
    const f = setup(domain), reader = { ...f.actor, scopeOrganizationId: f.organizationId };
    await f.read.authorizeRead(f.tx as never, f.readContext);
    expect(f.service.lockRecord).toHaveBeenCalledWith(f.tx, reader, f.problemId, 'READ');
    expect(f.service.authorizeRead).toHaveBeenCalledWith(f.tx, f.actor, f.record);
    const second = { ...f.record, problem: { ...f.record.problem, id: randomUUID() } };
    f.service.lockRecord.mockImplementation(async (_tx?: unknown, _actor?: unknown, id?: string) => id === second.problem.id ? second : f.record);
    const summaries = await f.read.readSummaries(f.tx as never, f.actor, [f.record.problem, second.problem]);
    expect(summaries.size).toBe(2);
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(summaries.get(f.problemId)).toMatchObject({ title: '8D-001', description: 'Current description', domainUiKey: domain.resourceType });
    expect(summaries.get(f.problemId)?.fields).toHaveLength(8);
    expect(f.service.readReport).not.toHaveBeenCalled();
    const workspace = await f.read.readWorkspace(f.tx as never, f.readContext, null);
    expect(workspace).toMatchObject({ domainVersion: 7, revisionId: null, sections: internalEightDSections(f.record.report.document) });
    expect(workspace?.summary.domainUiKey).toBe(domain.resourceType);
    const revision = { id: randomUUID(), recordedAt: new Date() };
    const pinned = { ...f.snapshot, document: { ...f.record.report.document, description: 'Pinned description' } };
    f.service.readReport.mockResolvedValueOnce({ record: f.record, revision, snapshot: pinned });
    expect(await f.read.readReport(f.tx as never, f.readContext, f.record.instance)).toMatchObject({ revisionId: revision.id, instanceId: f.record.instance.id,
      instanceVersion: 4, recordedAt: revision.recordedAt.toISOString(), summary: { description: 'Pinned description', domainUiKey: domain.resourceType },
      sections: internalEightDSections(pinned.document) });
    const evidence = await f.read.listEvidenceReferences(f.tx as never, f.readContext, revision.id);
    expect(evidence).toEqual(f.record.report.document.okFileIds.map(fileId => ({ fileId, resourceType: domain.resourceType, resourceId: f.problemId })));
    expect(f.service.readReport).toHaveBeenLastCalledWith(f.tx, reader, f.problemId, revision.id);
    const revisions = await f.read.listRevisionIds(f.tx as never, f.readContext);
    expect(revisions).toEqual(f.revisionRows.map(r => r.id));
    const actions = await f.read.describeActions(f.tx as never, f.readContext);
    expect(actions).toHaveLength(9);
    expect(actions.filter(a => a.enabled).map(a => a.actionKey)).toEqual(['read', 'save', 'sources'].map(key => `${domain.resourceType}:${key}`));
    expect(actions.find(a => !a.enabled)?.reasonCode).toBe(`${domain.storagePrefix.toUpperCase()}_ACTION_UNAVAILABLE`);
  });

  it('fails core read authorization before name/revision projections', async () => {
    const f = setup(domain); f.service.authorizeRead.mockRejectedValue(new HttpException('revoked', 403));
    await expect(f.read.readSummaries(f.tx as never, f.actor, [f.record.problem])).rejects.toMatchObject({ status: 403 });
    await expect(f.read.describeActions(f.tx as never, f.readContext)).rejects.toMatchObject({ status: 403 });
    expect(f.tx.$queryRaw).not.toHaveBeenCalled(); expect(f.service.allowedActions).not.toHaveBeenCalled();
  });

  it.each(['READ', 'REQUEST', 'ELIGIBILITY', 'DECIDE'] as const)('retains deadline authorization and context checks for %s', async operation => {
    const f = setup(domain);
    expect(await f.closure.deadlineContext(f.tx as never, f.context, f.actor, operation)).toBe(f.context);
    expect(f.service.lockRecord).toHaveBeenCalledWith(f.tx, f.actor, f.problemId, ['READ', 'ELIGIBILITY'].includes(operation) ? 'READ' : 'DEADLINE');
    expect(f.service.authorizeRead).toHaveBeenCalledWith(f.tx, f.actor, f.record);
    expect(f.service.authorizeDeadlineRequest).toHaveBeenCalledTimes(operation === 'REQUEST' ? 1 : 0);
    expect(f.permissionQueries).toHaveLength(['ELIGIBILITY', 'DECIDE'].includes(operation) ? 1 : 0);
    for (const query of f.permissionQueries) expect(query.values).toContain('workflow:act');
    if (['ELIGIBILITY', 'DECIDE'].includes(operation)) {
      f.tx.$queryRaw.mockResolvedValueOnce([{ allowed: false }]);
      await expect(f.closure.deadlineContext(f.tx as never, f.context, f.actor, operation)).rejects.toMatchObject({ status: 403 });
      expect(f.service.deadlineContext).toHaveBeenCalledTimes(1);
    }
    for (const key of ['organizationId', 'instanceId', 'workflowVersionId'] as const) {
      await expect(f.closure.deadlineContext(f.tx as never, { ...f.context, [key]: randomUUID() }, f.actor, operation)).rejects.toMatchObject({ status: 409 });
    }
  });

  it.each(['ANALYSIS', 'SUBMISSION', 'CLOSURE'] as const)('applies trusted %s extensions without synthesizing a user actor', async stage => {
    const f = setup(domain), dueAt = new Date();
    await f.closure.applyDeadlineExtension(f.tx as never, f.context, stage, dueAt);
    expect(f.service.notificationContext).toHaveBeenCalledWith(f.tx, f.organizationId, f.problemId);
    expect(f.service.applyApprovedDeadlineExtension).toHaveBeenCalledWith(f.tx, f.context, stage, dueAt);
    expect(f.service.lockRecord).not.toHaveBeenCalled();
    for (const key of ['instanceId', 'workflowVersionId', 'ownerUserId', 'professionalUserId', 'responsibleSectionDepartmentId'] as const) {
      f.service.notificationContext.mockResolvedValueOnce({ ...f.context, [key]: randomUUID() });
      await expect(f.closure.applyDeadlineExtension(f.tx as never, f.context, stage, dueAt)).rejects.toMatchObject({ status: 409 });
    }
    f.service.notificationContext.mockResolvedValueOnce(null);
    await expect(f.closure.applyDeadlineExtension(f.tx as never, f.context, stage, dueAt)).rejects.toMatchObject({ status: 409 });
    expect(f.service.applyApprovedDeadlineExtension).toHaveBeenCalledTimes(1);
  });
});

it('rejects copied/injected descriptors and mismatched domain cores before registering', () => {
  const f = setup();
  for (const domain of [{ ...domains.CUSTOMER }, { ...domains.CUSTOMER, storagePrefix: 'customer_eight_d; DROP TABLE users' }, domains.NEW_PRODUCT]) {
    for (const Adapter of [implementation!.InternalEightDClosureAdapter, implementation!.InternalEightDFileAdapter, implementation!.InternalEightDReadAdapter]) {
      expect(() => new Adapter({} as never, f.service as never, domain as never)).toThrow();
    }
  }
});

it('overrides only the new selection pair, retaining the old new-product-issue adapter', () => {
  const f = setup(domains.NEW_PRODUCT);
  const old = new DomainProblemReadAdapter({ domainCode: domains.NEW_PRODUCT.domainCode, sourceType: 'new-product-issue', permission: domains.NEW_PRODUCT.sourceReadPermission, label: 'Legacy' });
  const missing = new ProblemDomainRegistry([old]);
  expect(() => new implementation!.InternalEightDReadAdapter(missing, f.service as never, domains.NEW_PRODUCT).onModuleInit()).toThrow('PROBLEM_DOMAIN_REGISTRATION_INVALID');
  const registry = new ProblemDomainRegistry([old, new DomainProblemReadAdapter({ domainCode: domains.NEW_PRODUCT.domainCode, sourceType: domains.NEW_PRODUCT.sourceType,
    permission: domains.NEW_PRODUCT.sourceReadPermission, label: 'Selection' })]);
  const read = new implementation!.InternalEightDReadAdapter(registry, f.service as never, domains.NEW_PRODUCT);
  read.onModuleInit();
  expect(registry.forProblem(f.record.problem)).toBe(read);
  expect(registry.forProblem({ ...f.record.problem, sourceType: 'new-product-issue' })).toBe(old);
});
