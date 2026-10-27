import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../src/generated/prisma/client.js';
import { INTERNAL_EIGHT_D_DOMAIN, INTERNAL_EIGHT_D_DOMAINS, internalEightDSql } from '../../src/common/eight-d/internal-eight-d-domain.js';
import { ProcessEightDService } from '../../src/modules/process-quality/process-eight-d.service.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import type { DomainSourceIssueAdapters, DomainSourceIssueCommand } from '../../src/modules/problem-index/domain-source-issue.service.js';

const actor = { id: randomUUID(), organizationId: randomUUID(), accountType: 'INTERNAL', sessionId: randomUUID() };
const problemId = randomUUID();
const policy = { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: null };
const domains = Object.entries(INTERNAL_EIGHT_D_DOMAINS);

function fixture(domain = INTERNAL_EIGHT_D_DOMAINS.PROCESS as (typeof domains)[number][1]) {
  const queries: Prisma.Sql[] = [];
  const tx = {
    $queryRaw: async (query: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
      queries.push(Array.isArray(query) ? Prisma.sql(query as TemplateStringsArray, ...values) : query as Prisma.Sql);
      return [{ organizationId: actor.organizationId, present: true, digest: 'digest', response: {} }];
    },
    $executeRaw: async (query: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
      queries.push(Array.isArray(query) ? Prisma.sql(query as TemplateStringsArray, ...values) : query as Prisma.Sql);
      return 1;
    },
  };
  const service = Reflect.construct(ProcessEightDService, [{ $queryRaw: tx.$queryRaw }, ...Array(12).fill(undefined), domain]);
  return { service, tx, queries };
}

describe('bounded shared internal 8D core (unit only)', () => {
  it.each(domains)('%s uses only its own report/binding/revision/receipt/confirmation tables', async (_name, domain) => {
    const { service, tx, queries } = fixture(domain);
    await service.readResourceOrganizationId(tx, problemId);
    await service.hasReport(tx, actor.organizationId, problemId);
    await service.taskCandidates(tx, actor.organizationId, actor.id);
    await service.reminderCandidates(null, 10);
    await service.revisions(tx, { problem: { id: problemId, organizationId: actor.organizationId } });
    await service.readBinding(tx, actor.organizationId);
    await service.receipt(tx, actor, 'key', 'digest');
    await service.storeReceipt(tx, actor, 'key', 'digest', {});
    await service.confirmations(tx, actor, problemId, [{ defectId: randomUUID(), reason: 'confirmed', relatedProblemIds: [], recurrence: 'NOT_RECURRENCE' }]);
    expect(queries.slice(0, 4).every(q => q.sql.includes(`${domain.storagePrefix}_reports`))).toBe(true);
    expect(queries[4]!.sql).toContain(`${domain.storagePrefix}_revisions`);
    expect(queries[5]!.sql).toContain(`${domain.storagePrefix}_bindings`);
    expect(queries[6]!.sql).toContain(`${domain.storagePrefix}_receipts`);
    expect(queries[7]!.sql).toContain(`${domain.storagePrefix}_receipts`);
    expect(queries[8]!.sql).toContain(`${domain.storagePrefix}_source_confirmations`);
    expect(queries[8]!.sql).toContain(domain === INTERNAL_EIGHT_D_DOMAINS.PROCESS ? 'defect_id' : 'source_id');
    expect(internalEightDSql(domain).confirmationSourceColumn.sql).toBe(domain === INTERNAL_EIGHT_D_DOMAINS.PROCESS ? 'defect_id' : 'source_id');
    if (domain !== INTERNAL_EIGHT_D_DOMAINS.PROCESS) expect(queries.every(q => !q.sql.includes('process_eight_d'))).toBe(true);
  });

  it.each(domains)('%s scopes read/independent actions and evidence to the real domain', async (_name, domain) => {
    const { service, tx } = fixture(domain);
    const permissions: string[] = [];
    service.authorize = async (_tx: unknown, _actor: unknown, permission: string) => { permissions.push(permission); };
    const record = { problem: { id: problemId, organizationId: actor.organizationId, ownerId: actor.id }, collaboratorUserIds: [], report: {} };
    service.editable = () => undefined;
    service.assertOwnerAssignment = async () => undefined;
    await service.authorizeEdit(tx, actor, record);
    expect(permissions).toEqual([`${domain.permissionPrefix}:read`, `${domain.permissionPrefix}:work`]);
    for (const [action, grant] of [['RISK', 'risk'], ['SOURCES', 'sources'], ['DEADLINES', 'deadlines']]) {
      permissions.length = 0;
      await service.replayAccess(tx, actor, record, action);
      expect(permissions).toEqual([`${domain.permissionPrefix}:${grant}`]);
    }
    const access = jest.fn(async () => undefined);
    service.resources = { authorizeAndLock: access };
    service.evidenceSnapshot = async () => [];
    await service.assertEvidence(tx, actor, record, [randomUUID()]);
    expect(access).toHaveBeenCalledWith(tx, actor, { resourceType: domain.resourceType, resourceId: problemId }, 'read');
    const predicate = service.visibilityPredicate(actor, actor.organizationId, Prisma.sql`FALSE`) as Prisma.Sql;
    expect(predicate.sql).toContain(`${domain.storagePrefix}_reports`);
    expect(predicate.sql).toContain(`${domain.permissionPrefix}:read`);
  });

  it.each(domains)('%s validates the INTERNAL marker against its exact closure domain', async (_name, domain) => {
    const { service } = fixture(domain);
    const version = { nodes: [
      { id: 'owner', type: 'ACTION', config: { isStart: true, processEightD: policy } },
      { id: 'gate', type: 'APPROVAL', config: { closureReview: { policy: 'INTERNAL', domainCode: domain.domainCode } } },
      { id: 'end', type: 'CLOSE', config: { isEnd: true } },
    ], transitions: [
      { fromNodeId: 'owner', toNodeId: 'gate', action: 'SUBMIT' },
      { fromNodeId: 'gate', toNodeId: 'owner', action: 'RETURN' },
      { fromNodeId: 'gate', toNodeId: 'end', action: 'APPROVE' },
    ] };
    const tx = { workflowVersion: { findFirst: async () => version } };
    await expect(service.validateFlow(tx, actor.organizationId, randomUUID(), randomUUID())).resolves.toBe(version);
    for (const wrong of Object.values(INTERNAL_EIGHT_D_DOMAINS).filter(other => other !== domain)) {
      version.nodes[1]!.config.closureReview!.domainCode = wrong.domainCode;
      await expect(service.validateFlow(tx, actor.organizationId, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    }
    version.nodes[1]!.config.closureReview!.domainCode = domain.domainCode;
    version.nodes[1]!.config.closureReview!.policy = 'SUPPLIER';
    await expect(service.validateFlow(tx, actor.organizationId, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it.each(domains)('%s emits its own audit and outbox identity on a CAS deadline change', async (name, domain) => {
    const { service, tx, queries } = fixture(domain);
    const audits: Record<string, unknown>[] = [], events: Record<string, unknown>[] = [];
    service.audit = { record: async (event: Record<string, unknown>) => { audits.push(event); } };
    service.outbox = { enqueue: async (event: Record<string, unknown>) => { events.push(event); } };
    const record = { problem: { id: problemId, organizationId: actor.organizationId }, instance: { status: 'RUNNING' },
      report: { version: 4, analysisDueAt: new Date('2026-10-27T00:00:00Z') } };
    await service.applyDeadlineExtension(tx, record, 'ANALYSIS', new Date('2026-10-28T00:00:00Z'));
    expect(queries[0]!.sql).toContain(`UPDATE ${domain.storagePrefix}_reports`);
    expect(queries[0]!.values).toContain(4);
    expect(audits[0]!.action).toBe(`${name}_EIGHT_D_DEADLINE_EXTENDED`);
    expect(events[0]!.eventType).toBe(`${name}_EIGHT_D_DEADLINE_EXTENDED`);
    expect(events[0]!.eventKey).toBe(`${domain.resourceType}:${problemId}:deadline:5`);
  });

  it.each(domains)('%s fails a stale CAS without emitting deadline side effects', async (_name, domain) => {
    const { service, tx } = fixture(domain);
    tx.$executeRaw = async () => 0;
    const audit = jest.fn(async () => undefined), outbox = jest.fn(async () => undefined);
    service.audit = { record: audit }; service.outbox = { enqueue: outbox };
    const record = { problem: { id: problemId, organizationId: actor.organizationId }, instance: { status: 'RUNNING' },
      report: { version: 4, analysisDueAt: new Date('2026-10-27T00:00:00Z') } };
    await expect(service.applyDeadlineExtension(tx, record, 'ANALYSIS', new Date('2026-10-28T00:00:00Z')))
      .rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(audit).not.toHaveBeenCalled(); expect(outbox).not.toHaveBeenCalled();
  });

  it.each(domains)('%s preserves its confirmation source column and public source snapshots', async (_name, domain) => {
    const { service, tx, queries } = fixture(domain);
    const source = { sourceDomain: domain.sourceDomain, sourceType: domain.sourceType, sourceId: randomUUID(), sourceVersion: 9,
      sourceSnapshot: { realDomainOwnedField: 'preserved' } };
    Object.assign(tx, { domainSourceIssueLink: { findMany: async () => [source] } });
    service.rounds = { readHistoryProjection: async () => [] };
    const record = { problem: { id: problemId, organizationId: actor.organizationId, sourceId: source.sourceId }, instance: {},
      collaboratorUserIds: [], report: { document: {}, contentVersion: 2, version: 3 } };
    const snapshot = await service.fullSnapshot(tx, record);
    expect(queries[0]!.sql).toContain(`SELECT ${domain === INTERNAL_EIGHT_D_DOMAINS.PROCESS ? 'defect_id' : 'source_id'} AS "defectId"`);
    expect(queries[0]!.sql).toContain(`FROM ${domain.storagePrefix}_source_confirmations`);
    expect(snapshot.sources).toEqual([source]);
  });

  it.each(domains)('%s locks the problem/instance/own report and queries only the matching identity', async (_name, domain) => {
    const { service, tx, queries } = fixture(domain);
    const lookup = jest.fn(async () => ({ id: problemId, organizationId: actor.organizationId, workflowInstanceId: randomUUID() }));
    const workflowVersionId = randomUUID();
    Object.assign(tx, {
      problemIndex: { findFirst: lookup },
      workflowInstance: { findFirst: async () => ({ currentNode: { organizationId: actor.organizationId, workflowVersionId }, workflowVersionId,
        workflowVersion: { status: 'PUBLISHED', organizationId: actor.organizationId } }) },
    });
    await service.lockRecord(tx, actor, problemId, 'EDIT');
    expect(lookup).toHaveBeenCalledWith({ where: { id: problemId, organizationId: actor.organizationId,
      domainCode: domain.domainCode, sourceType: domain.sourceType, archivedAt: null } });
    expect(queries[0]!.sql).toContain('FROM problem_indexes');
    expect(queries[1]!.sql).toContain('FROM workflow_instances');
    expect(queries[2]!.sql).toContain(`FROM ${domain.storagePrefix}_reports`);
    expect(queries.slice(0, 3).every(query => query.sql.includes('FOR UPDATE'))).toBe(true);
    expect(queries[3]!.sql).toContain(`FROM ${domain.storagePrefix}_collaborators`);
  });

  it('retains literal permission SQL for the existing default assignment/visibility fixtures', () => {
    const { service } = fixture();
    const predicate = service.visibilityPredicate(actor, actor.organizationId, Prisma.sql`FALSE`) as Prisma.Sql;
    expect(predicate.sql).toContain('process-quality:issues:read');
  });

  it.each(domains)('%s rejects wrong-domain and wrong-ID source ports before preview or update', async (_name, domain) => {
    const { service, tx } = fixture(domain);
    const defectId = randomUUID();
    const reference = { sourceDomain: domain.sourceDomain as string, sourceType: domain.sourceType as string, sourceId: defectId,
      sourceVersion: 1, sourceSnapshot: {}, createdBy: actor.id };
    const reader = jest.fn(async () => reference);
    const command = jest.fn(async () => undefined);
    service.ledger = { sourceReference: reader };
    service.transaction = async (work: (tx: unknown) => unknown) => work(tx);
    const permissions: string[] = [];
    service.authorize = async (_tx: unknown, _actor: unknown, permission: string) => { permissions.push(permission); };
    service.sourcePreview = async () => ({ preview: { defectId } });
    service.command = command;
    await expect(service.previewSources(actor, { sources: [{ defectId, expectedVersion: 1 }] })).resolves.toEqual([{ defectId }]);
    expect(reader).toHaveBeenCalledWith(actor, defectId);
    expect(permissions).toEqual([domain.sourceReadPermission, `${domain.permissionPrefix}:issue`]);
    for (const corrupt of [() => { reference.sourceDomain = 'supplier-quality'; },
      () => { reference.sourceType = 'foreign-source'; }, () => { reference.sourceType = 'new-product-issue'; },
      () => { reference.sourceId = randomUUID(); }]) {
      reference.sourceDomain = domain.sourceDomain; reference.sourceType = domain.sourceType; reference.sourceId = defectId;
      corrupt();
      await expect(service.previewSources(actor, { sources: [{ defectId, expectedVersion: 1 }] })).rejects.toMatchObject({ status: 400 });
      await expect(service.sources(actor, problemId, { add: [{ defectId, expectedVersion: 1 }], removeDefectIds: [], expectedVersion: 1 }, 'trace', 'test-key'))
        .rejects.toMatchObject({ status: 400 });
      expect(command).not.toHaveBeenCalled();
    }
  });

  it.each(domains)('%s keeps the actual issuer, locked owner and trusted runtime callback on issue', async (name, domain) => {
    const { service, tx, queries } = fixture(domain);
    const defectId = randomUUID(), ownerUserId = randomUUID(), responsibleSectionDepartmentId = randomUUID();
    const source = { sourceDomain: domain.sourceDomain, sourceType: domain.sourceType, sourceId: defectId,
      sourceVersion: 1, sourceSnapshot: { realSource: true }, createdBy: randomUUID() };
    const binding = { workflowDefinitionId: randomUUID(), workflowVersionId: randomUUID(), enabled: true };
    const events: string[] = [], permissions: string[] = [], audit: Record<string, unknown>[] = [];
    const resolver = jest.fn(async () => { events.push('resolve'); return { ...source, organizationId: actor.organizationId }; });
    service.prisma = { outboxEvent: { findUnique: async () => null } };
    service.transaction = async (work: (tx: unknown) => unknown) => work(tx);
    service.ledger = { sourceReference: async () => source, lockAndResolve: resolver };
    service.authorize = async (_tx: unknown, _actor: unknown, permission: string) => { permissions.push(permission); };
    service.readBinding = async () => binding;
    service.validateFlow = async () => undefined;
    service.assertOwnerAssignment = async () => { events.push('owner-assignment'); };
    service.eligibleWorker = async () => { events.push('owner-work'); return true; };
    service.lockUsers = async (_tx: unknown, _org: string, ids: string[]) => { expect(ids).toEqual([ownerUserId]); events.push('owner-lock'); };
    service.confirmSourcePreview = async () => undefined;
    service.audit = { record: async (event: Record<string, unknown>) => { audit.push(event); } };
    service.runtime = { startInstance: async (command: Record<string, unknown>, transaction: unknown, _unused: unknown, authorize: (tx: unknown) => Promise<void>) => {
      expect(command).toMatchObject({ actor, expectedProblemVersion: 7, workflowDefinitionId: binding.workflowDefinitionId, workflowVersionId: binding.workflowVersionId });
      expect(transaction).toBe(tx);
      await authorize(tx); events.push('trusted-runtime');
      return { instanceId: randomUUID() };
    } };
    service.domainIssues = { issue: async (command: DomainSourceIssueCommand, adapters: DomainSourceIssueAdapters) => {
      expect(command).toMatchObject({ actor, source, problemType: domain.problemType, responsibleScope: domain.domainCode, responseForm: 'EIGHT_D' });
      await adapters.authorize(tx as never, command, false);
      await adapters.lockAndResolve(tx as never, source);
      await adapters.bindWorkflow(tx as never, { organizationId: actor.organizationId, problemIndexId: problemId, expectedProblemVersion: 7 } as never);
      return { problem: { id: problemId }, replayed: false };
    } };
    await expect(service.issue(actor, { sources: [{ defectId, expectedVersion: 1 }], ownerUserId, responsibleSectionDepartmentId, severity: 'LOW' }, 'trace', 'test-key'))
      .resolves.toEqual({ problem: { id: problemId }, replayed: false });
    expect(events).toEqual(['owner-assignment', 'owner-work', 'resolve', 'owner-lock', 'owner-assignment', 'owner-work', 'trusted-runtime']);
    expect(resolver.mock.calls[0]).toEqual(domain === INTERNAL_EIGHT_D_DOMAINS.PROCESS ? [tx, source] : [tx, source, actor]);
    expect(permissions).toContain(domain.sourceReadPermission);
    expect(permissions.filter(p => p === `${domain.permissionPrefix}:issue`)).toHaveLength(3);
    expect(queries[0]!.sql).toContain(`INSERT INTO ${domain.storagePrefix}_reports`);
    expect(queries[0]!.values[3]).toBe(actor.id);
    expect(audit[0]).toMatchObject({ action: `${name}_EIGHT_D_ISSUED`, actorUserId: actor.id });
  });

  it('keeps Nest resolution explicit for both the original ledger and optional descriptor', async () => {
    const parameters = Reflect.getMetadata('design:paramtypes', ProcessEightDService) as unknown[];
    const dependencies = parameters.slice(0, 13).map((token, index) => ({ provide: index === 1 ? ProcessDefectLedgerService : token, useValue: {} }));
    const module = await Test.createTestingModule({ providers: [ProcessEightDService, ...dependencies] }).compile();
    expect(module.get(ProcessEightDService).domain).toBe(INTERNAL_EIGHT_D_DOMAINS.PROCESS);
    await module.close();
    const configured = await Test.createTestingModule({ providers: [ProcessEightDService, ...dependencies,
      { provide: INTERNAL_EIGHT_D_DOMAIN, useValue: INTERNAL_EIGHT_D_DOMAINS.CUSTOMER }] }).compile();
    expect(configured.get(ProcessEightDService).domain).toBe(INTERNAL_EIGHT_D_DOMAINS.CUSTOMER);
    await configured.close();
  });
});
