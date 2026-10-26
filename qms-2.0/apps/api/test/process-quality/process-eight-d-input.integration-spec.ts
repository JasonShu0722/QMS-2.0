import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { assertEightDSources, assertSourceConfirmation, eightDRequestDigest } from '../../src/modules/process-quality/process-eight-d-policy.js';
import { ProcessEightDService } from '../../src/modules/process-quality/process-eight-d.service.js';
import { ProcessEightDController } from '../../src/modules/process-quality/process-eight-d.controller.js';
import * as dtos from '../../src/modules/process-quality/process-eight-d.dto.js';
import type { ProcessEightDRecord } from '../../src/modules/process-quality/process-eight-d.types.js';
import { normalizeProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { assertActiveAuthentication } from '../../src/common/security/session-security.js';
import { DomainSourceLinkService } from '../../src/modules/problem-index/domain-source-link.service.js';

describe('process 8D trust-boundary policy', () => {
  it('includes actual explicit date values in idempotency fingerprints', () => {
    expect(eightDRequestDigest({ dueAt: new Date('2026-10-25') })).not.toEqual(eightDRequestDigest({ dueAt: new Date('2026-10-26') }));
  });
  it('rejects empty, duplicate and stale source commands rather than manufacturing sources', () => {
    const source = { defectId: randomUUID(), expectedVersion: 1 };
    expect(() => assertEightDSources([])).toThrow();
    expect(() => assertEightDSources([source, source])).toThrow();
    expect(() => assertEightDSources([{ ...source, expectedVersion: 0 }])).toThrow();
    expect(() => assertEightDSources([null as never])).toThrow();
    expect(() => assertEightDSources([source])).not.toThrow();
  });
  it('requires an explicit exact related-problem confirmation, including non-recurrence', () => {
    const defectId = randomUUID(), problemId = randomUUID();
    expect(() => assertSourceConfirmation(defectId, [problemId], [])).toThrow();
    expect(() => assertSourceConfirmation(defectId, [problemId], [{ defectId, relatedProblemIds: [], recurrence: 'NOT_RECURRENCE', reason: '不同原因' }])).toThrow();
    expect(() => assertSourceConfirmation(defectId, [problemId], [{ defectId, relatedProblemIds: [problemId], recurrence: 'NOT_RECURRENCE', reason: '不同原因' }])).not.toThrow();
    expect(() => assertSourceConfirmation(defectId, [problemId], [{ defectId, relatedProblemIds: [problemId, problemId], recurrence: 'RECURRENCE' }])).toThrow();
  });
});

describe('process 8D analysis completion command (no database)', () => {
  const actor = { id: randomUUID(), organizationId: randomUUID(), accountType: 'INTERNAL' as const, sessionId: randomUUID() };
  const dueAt = new Date('2026-11-10T00:00:00Z');
  function command(analysisCompletedAt: Date | null, submissionDueAt = dueAt) {
    const record = { problem: { ownerId: actor.id }, report: { analysisCompletedAt, submissionDueAt,
      document: normalizeProcessEightDDocument({ occurrenceCause: 'Occurrence', escapeCause: 'Escape', correctiveActions: ['OCCURRENCE', 'ESCAPE'].map((causeKind, i) => ({
        id: `action-${i}`, causeKind, action: 'Action', owner: 'Owner', plannedAt: '2026-10-25', verificationMethod: 'Measure',
      })) }) } } as ProcessEightDRecord;
    const updates: unknown[] = [];
    // Only transaction/auth/evidence plumbing is replaced; execute the real domain command.
    const service = Object.assign(Object.create(ProcessEightDService.prototype), {
      command: async (_actor: unknown, _id: string, _input: unknown, _action: string, _key: string, _trace: string,
        work: (tx: unknown, record: ProcessEightDRecord) => Promise<void>) => work({}, record),
      authorizeEdit: async () => {}, assertEvidence: async () => {},
      updateReport: async (_tx: unknown, _actor: unknown, _record: unknown, fields: unknown) => { updates.push(fields); },
    }) as ProcessEightDService;
    return { service, updates };
  }
  it('does not rewrite completion time or row version for a repeated completion with the same plan', async () => {
    const { service, updates } = command(new Date('2026-10-25T00:00:00Z'));
    await service.analysisComplete(actor, randomUUID(), { expectedVersion: 3, submissionDueAt: dueAt }, randomUUID(), randomUUID());
    expect(updates).toHaveLength(0);
  });
  it.each([new Date('2026-10-25T00:00:00Z'), null])('requires an approved extension rather than replanning an existing submission date (%s)', async completedAt => {
    const { service, updates } = command(completedAt);
    await expect(service.analysisComplete(actor, randomUUID(), { expectedVersion: 3, submissionDueAt: new Date('2026-12-10T00:00:00Z') }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 409, response: { code: 'PROCESS_EIGHT_D_EXTENSION_REQUIRED' } });
    expect(updates).toHaveLength(0);
  });
  it('allows re-confirmation after an analysis edit without moving the existing submission plan', async () => {
    const { service, updates } = command(null);
    await service.analysisComplete(actor, randomUUID(), { expectedVersion: 3, submissionDueAt: dueAt }, randomUUID(), randomUUID());
    expect(updates).toHaveLength(1);
  });
});

describe('process 8D source preview HTTP contract (no database)', () => {
  it('uses registered domain visibility rather than treating every related domain as readable', async () => {
    let visibilityChecks = 0;
    const service = Object.assign(Object.create(ProcessEightDService.prototype), {
      readRegistry: { visibility: () => { visibilityChecks++; return Prisma.sql`FALSE`; } },
    }) as { visibleSourceProblems: (tx: unknown, actor: unknown, defectId: string, ids: string[]) => Promise<unknown> };
    await service.visibleSourceProblems({ $queryRaw: async () => [] }, { id: randomUUID(), organizationId: randomUUID() }, randomUUID(), [randomUUID()]);
    expect(visibilityChecks).toBe(1);
  });
  it('exposes a typed preview before issuing or changing sources', () => {
    expect(dtos).toHaveProperty('ProcessEightDSourcePreviewDto');
    expect(dtos).toHaveProperty('ProcessEightDSourcePreviewInputDto');
    const preview = ProcessEightDController.prototype as unknown as { previewSources: (...args: unknown[]) => unknown };
    expect(typeof preview.previewSources).toBe('function');
    expect(Reflect.getMetadata('path', preview.previewSources)).toBe('sources/preview');
    expect(Reflect.getMetadata('__httpCode__', preview.previewSources)).toBe(200);
  });
  it.each([null, 'saved-revision'])('redacts hidden confirmation IDs from current and historical report reads (%s)', async revisionId => {
    const visible = randomUUID(), hidden = randomUUID(), defectId = randomUUID();
    const snapshot = { sourceConfirmations: [{ defectId, relatedProblemIds: [visible, hidden], recurrence: 'RECURRENCE' }] };
    const record = { report: { closedRevisionId: null } };
    const service = Object.assign(Object.create(ProcessEightDService.prototype), {
      lockRecord: async () => record, authorizeRead: async () => {}, fullSnapshot: async () => snapshot,
      revisions: async () => [{ id: 'saved-revision', snapshot }],
      visibleSourceProblems: async () => [{ problemId: visible }],
    }) as ProcessEightDService;
    const result = await service.readReport({} as never, {} as never, randomUUID(), revisionId);
    expect(JSON.stringify(result)).not.toContain(hidden);
    expect(result.snapshot).toEqual({ sourceConfirmations: [{ defectId, relatedProblemIds: [visible], recurrence: 'RECURRENCE', hasHiddenRelations: true }] });
    expect(snapshot.sourceConfirmations[0]!.relatedProblemIds).toEqual([visible, hidden]);
  });
});

describe('process 8D assignment options (no database)', () => {
  const actor = { id: randomUUID(), organizationId: randomUUID(), accountType: 'INTERNAL' as const, sessionId: randomUUID() };
  function options() {
    const permissions: string[] = [], departmentCalls: unknown[][] = [], queries: Prisma.Sql[] = [];
    const user = { id: randomUUID(), username: 'worker', fullName: 'Worker' };
    const service = Object.assign(Object.create(ProcessEightDService.prototype), {
      transaction: async (work: (tx: unknown) => unknown) => work({ $queryRaw: async (query: Prisma.Sql) => { queries.push(query); return [{ users: [{ ...user, email: 'not-public', sessionId: 'not-public' }], userTotal: 1 }]; } }),
      authorize: async (_tx: unknown, _actor: unknown, permission: string) => { permissions.push(permission); },
      responsibilities: { workflowDepartmentOptions: async (...args: unknown[]) => { departmentCalls.push(args); return { items: [{ id: randomUUID(), code: 'SEC', name: 'Section' }], total: 1 }; } },
    }) as ProcessEightDService & { assignmentOptions: (actor: unknown, query: unknown) => Promise<{ users: unknown[]; userTotal: number; page: number; pageSize: number }> };
    return { service, permissions, departmentCalls, queries, user };
  }
  it('exposes a dedicated Swagger query/response and a static GET route', () => {
    expect(dtos).toHaveProperty('ProcessEightDAssignmentOptionsQueryDto');
    expect(dtos).toHaveProperty('ProcessEightDAssignmentOptionsDto');
    const controller = ProcessEightDController.prototype as unknown as { assignmentOptions: (...args: unknown[]) => unknown };
    expect(typeof controller.assignmentOptions).toBe('function');
    expect(Reflect.getMetadata('path', controller.assignmentOptions)).toBe('assignment-options');
    expect(Reflect.getMetadata('method', controller.assignmentOptions)).toBe(0);
  });
  it('uses domain read/issue permissions, public department options, bounded search/pagination and name-only users', async () => {
    const { service, permissions, departmentCalls, queries, user } = options();
    const result = await service.assignmentOptions(actor, { action: 'ISSUE', page: 2, pageSize: 5, search: ' worker ' });
    expect(result).toMatchObject({ users: [user], userTotal: 1, page: 2, pageSize: 5 });
    expect(permissions).toContain('process-quality:issues:read');
    expect(permissions).toContain('process-quality:issues:issue');
    expect(permissions.some(p => p === 'workflow:manage' || p === 'organization:structure:manage')).toBe(false);
    expect(departmentCalls[0]!.slice(1)).toEqual([actor.organizationId, 'worker', 5, 5, undefined]);
    expect(queries[0]!.sql).toContain('process-quality:issues:work');
    expect(queries[0]!.sql).toContain('process-quality:issues:read');
    expect(JSON.stringify(result)).not.toContain('not-public');
  });
  it.each([{ pageSize: 101 }, { page: 0 }, { sectionDepartmentId: 'not-a-uuid' }, { action: 'REASSIGN' }, { action: 'COLLABORATORS' }])('rejects invalid assignment queries before reading candidates (%j)', async query => {
    const { service, queries } = options();
    await expect(service.assignmentOptions(actor, query)).rejects.toMatchObject({ status: 400 });
    expect(queries).toHaveLength(0);
  });
  it.each(['REASSIGN', 'COLLABORATORS'])('uses current action eligibility for %s without requiring configuration permissions', async action => {
    const { service, permissions, queries } = options(), sectionId = randomUUID();
    Object.assign(service, { lockRecord: async () => ({ problem: { ownerId: actor.id }, report: { responsibleSectionDepartmentId: sectionId } }),
      feature: async () => false, authorizeRead: async () => {}, editable: () => {}, assertOwnerAssignment: async () => {},
      authorizeEdit: async () => { permissions.push('process-quality:issues:work'); } });
    await service.assignmentOptions(actor, { action, problemId: randomUUID() });
    expect(permissions).toContain('process-quality:issues:work');
    if (action === 'REASSIGN') expect(queries[0]!.values).toContain(sectionId);
    else expect(queries[0]!.sql).not.toContain('pos.department_id =');
  });
  it('rejects a missing issue permission before listing names', async () => {
    const { service, queries, departmentCalls } = options();
    Object.assign(service, { authorize: async (_tx: unknown, _actor: unknown, permission: string) => {
      if (permission === 'process-quality:issues:issue') throw Object.assign(new Error('Forbidden'), { status: 403 });
    } });
    await expect(service.assignmentOptions(actor, {})).rejects.toMatchObject({ status: 403 });
    expect(queries).toHaveLength(0); expect(departmentCalls).toHaveLength(0);
  });
});

describe('process 8D relation confirmation fingerprints (no database)', () => {
  it('reveals only visible problems and requires a fresh fingerprint for hidden relations', async () => {
    const actor = { id: randomUUID(), organizationId: randomUUID() }, defectId = randomUUID(), visible = randomUUID(), hidden = randomUUID();
    const ids = [visible, hidden];
    const tx = { domainSourceIssueLink: { findMany: async () => ids.map(problemIndexId => ({ problemIndexId })) }, $queryRaw: async () => [] };
    const service = Object.assign(Object.create(ProcessEightDService.prototype), { visibleSourceProblems: async () => [{ problemId: visible, reportNumber: 'VISIBLE', title: 'Allowed', status: 'OPEN', primary: true }] });
    const { preview } = await service.sourcePreview(tx, actor, defectId);
    expect(preview.hasHiddenRelations).toBe(true);
    expect(JSON.stringify(preview)).not.toContain(hidden);
    const confirmation = { defectId, relatedProblemIds: [visible], recurrence: 'NOT_RECURRENCE', relatedSetToken: preview.relatedSetToken };
    const accepted = await service.confirmSourcePreview(tx, actor, defectId, [confirmation]);
    expect(accepted).toMatchObject({ relatedProblemIds: [...ids].sort(), recurrence: 'NOT_RECURRENCE' });
    await expect(service.confirmSourcePreview(tx, actor, defectId, [{ ...confirmation, relatedSetToken: undefined }])).rejects.toMatchObject({ status: 409 });
    ids.push(randomUUID());
    await expect(service.confirmSourcePreview(tx, actor, defectId, [confirmation])).rejects.toMatchObject({ status: 409 });
  });
});

describe('process 8D deadline projection boundary (no database)', () => {
  it.each(['ANALYSIS', 'SUBMISSION', 'CLOSURE'] as const)('uses the public problem service and the caller transaction only for %s closure projection', async stage => {
    const calls: unknown[][] = [], old = new Date('2026-11-01'), dueAt = new Date('2026-12-01');
    const tx = { $executeRaw: async () => 1 };
    const record = { problem: { id: randomUUID(), organizationId: randomUUID(), version: 7, closedAt: null }, instance: { status: 'RUNNING' },
      report: { version: 3, closedRevisionId: null, analysisDueAt: old, submissionDueAt: old, closureDueAt: old, analysisCompletedAt: null, submittedAt: null } } as ProcessEightDRecord;
    const service = Object.assign(Object.create(ProcessEightDService.prototype), {
      problems: { updateDomainSummary: async (...args: unknown[]) => { calls.push(args); } },
      audit: { record: async () => {} }, outbox: { enqueue: async () => {} },
    }) as ProcessEightDService;
    await service.applyDeadlineExtension(tx as never, record, stage, dueAt);
    expect(calls).toHaveLength(stage === 'CLOSURE' ? 1 : 0);
    if (stage === 'CLOSURE') {
      expect(calls[0]![0]).toBe(tx);
      expect(calls[0]![1]).toEqual({ organizationId: record.problem.organizationId, id: record.problem.id, expectedVersion: 7, dueAt });
    }
  });
});

describe('process 8D source authentication lock boundary (no database)', () => {
  const actor = { id: randomUUID(), organizationId: randomUUID(), sessionId: randomUUID(), accountType: 'INTERNAL' as const };
  function authentication() {
    const queries: string[] = [];
    const user = { id: actor.id, organizationId: actor.organizationId, status: 'ACTIVE', mustChangePassword: false,
      securityVersion: 4, mfaEnabled: false, mfaPreference: 'DEFAULT', mfaRequirementOverride: null as boolean | null, organization: { status: 'ACTIVE' } };
    const session = { securityVersion: 4, mfaVerifiedAt: new Date() as Date | null, revokedAt: null as Date | null, expiresAt: new Date(Date.now() + 60_000) };
    const tx = { $queryRaw: async (parts: TemplateStringsArray | Prisma.Sql) => { queries.push(Array.isArray(parts) ? parts.join('?') : (parts as Prisma.Sql).sql); return []; },
      user: { findUnique: async () => user }, organization: { findUnique: async () => user.organization },
      session: { findFirst: async () => session.revokedAt || session.expiresAt <= new Date() || session.securityVersion !== user.securityVersion ? null : session },
      userRole: { findMany: async () => [] }, userPosition: { findMany: async () => [] } };
    return { tx, queries, user, session };
  }
  it.each([undefined, 'SHARE'] as const)('keeps full authentication and the session lock with user lock %s', async mode => {
    const { tx, queries } = authentication();
    await assertActiveAuthentication(tx as never, actor, mode);
    expect(queries[0]).toContain(mode === 'SHARE' ? 'FOR SHARE' : 'FOR NO KEY UPDATE');
    expect(queries.some(query => query.includes('FROM sessions') && query.includes('FOR UPDATE'))).toBe(true);
  });
  it.each(['SESSION', 'VERSION', 'MFA'] as const)('never bypasses %s validation in shared-user mode', async invalid => {
    const { tx, user, session } = authentication();
    if (invalid === 'SESSION') session.revokedAt = new Date();
    if (invalid === 'VERSION') user.securityVersion++;
    if (invalid === 'MFA') { user.mfaRequirementOverride = true; session.mfaVerifiedAt = null; }
    await expect(assertActiveAuthentication(tx as never, actor, 'SHARE')).rejects.toMatchObject({
      status: 401, response: { code: invalid === 'MFA' ? 'AUTH_MFA_REQUIRED' : 'AUTH_SESSION_REQUIRED' },
    });
  });
  it.each([false, true])('selects shared authentication only for server-owned outer transactions (%s)', async outer => {
    const { tx, queries } = authentication();
    Object.assign(tx, { $queryRaw: async (parts: TemplateStringsArray | Prisma.Sql) => {
      const sql = Array.isArray(parts) ? parts.join('?') : (parts as Prisma.Sql).sql;
      queries.push(sql); return sql.includes('transaction_isolation') ? [{ transaction_isolation: 'read committed' }] : [];
    } });
    const stop = new Error('authenticated boundary');
    const service = new DomainSourceLinkService({ $transaction: async (work: (tx: unknown) => unknown) => work(tx) } as never, {} as never, {} as never);
    await expect(service.change({ organizationId: actor.organizationId, problemIndexId: randomUUID(), actor, expectedProblemVersion: 1,
      add: [], remove: [{ sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: randomUUID() }], idempotencyKey: randomUUID(), traceId: randomUUID() },
    { authorize: async () => { throw stop; }, lockAndResolve: async () => null }, outer ? tx as never : undefined)).rejects.toBe(stop);
    expect(queries.find(sql => sql.includes('FROM users'))).toContain(outer ? 'FOR SHARE' : 'FOR NO KEY UPDATE');
  });
});

describe('process 8D issue owner post-source boundary (no database)', () => {
  it.each(['ASSIGNMENT', 'WORK', 'VALID'] as const)('revalidates the locked owner after source resolution and before runtime binding (%s)', async state => {
    const events: string[] = [], actor = { id: randomUUID(), organizationId: randomUUID(), accountType: 'INTERNAL', sessionId: randomUUID() };
    const ownerUserId = randomUUID(), defectId = randomUUID(), responsibleSectionDepartmentId = randomUUID();
    const bound = { enabled: true, workflowDefinitionId: randomUUID(), workflowVersionId: randomUUID() };
    let afterSource = false;
    const tx = { $executeRaw: async () => 1 };
    const service = Object.assign(Object.create(ProcessEightDService.prototype), {
      prisma: { outboxEvent: { findUnique: async () => null } }, transaction: async (work: (tx: unknown) => unknown) => work(tx),
      ledger: { sourceReference: async () => ({ sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: defectId, sourceVersion: 1 }) },
      authorize: async () => {}, readBinding: async () => bound, validateFlow: async () => {},
      lockUsers: async (_tx: unknown, _org: string, ids: string[]) => { expect(ids).toContain(ownerUserId); events.push('lock owner'); },
      assertOwnerAssignment: async () => { events.push(afterSource ? 'late assignment' : 'early assignment');
        if (afterSource && state === 'ASSIGNMENT') throw Object.assign(new Error('expired'), { status: 403 }); },
      eligibleWorker: async () => { events.push(afterSource ? 'late work' : 'early work'); return !(afterSource && state === 'WORK'); },
      domainIssues: { issue: async (_command: unknown, adapters: { authorize: (tx: unknown, command: unknown, replay: boolean) => Promise<void>; bindWorkflow: (tx: unknown, binding: unknown) => Promise<unknown> }) => {
        await adapters.authorize(tx, {}, false); events.push('source resolved'); afterSource = true;
        await adapters.bindWorkflow(tx, { organizationId: actor.organizationId, problemIndexId: randomUUID(), expectedProblemVersion: 1 }); return {};
      } },
      runtime: { startInstance: async () => { events.push('runtime'); return {}; } }, confirmations: async () => {}, audit: { record: async () => {} },
    }) as ProcessEightDService;
    const result = service.issue(actor as never, { sources: [{ defectId, expectedVersion: 1 }], ownerUserId, responsibleSectionDepartmentId, severity: 'LOW' }, randomUUID(), randomUUID());
    if (state === 'VALID') { await result; expect(events.slice(-5)).toEqual(['source resolved', 'lock owner', 'late assignment', 'late work', 'runtime']); }
    else { await expect(result).rejects.toMatchObject({ status: 403 }); expect(events).not.toContain('runtime'); }
  });
});
