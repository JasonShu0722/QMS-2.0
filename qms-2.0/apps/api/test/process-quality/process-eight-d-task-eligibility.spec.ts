import 'reflect-metadata';
import { jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';

// Keep this projection-only suite independent of the concurrently edited document/report sources.
jest.unstable_mockModule('../../src/modules/process-quality/process-eight-d-document.js', () => ({
  analysisCompletionIssues: () => [], documentFileIds: (document: { okFileIds: string[] }) => document.okFileIds,
  emptyProcessEightDDocument: () => ({}), normalizeProcessEightDDocument: (document: unknown) => document,
  ProcessEightDDocumentError: class extends Error {}, submissionIssues: () => [],
}));
jest.unstable_mockModule('../../src/modules/process-quality/process-eight-d-reminder.service.js', () => ({ ProcessEightDReminderService: class {} }));
const { ProcessEightDService } = await import('../../src/modules/process-quality/process-eight-d.service.js');
const { ProcessEightDTaskService } = await import('../../src/modules/process-quality/process-eight-d-task.service.js');

const actor = { id: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-000000000002', accountType: 'INTERNAL', sessionId: '00000000-0000-4000-8000-000000000003' } as const;
const problemId = '00000000-0000-4000-8000-000000000004';
function fixture() {
  const c = { problemId, organizationId: actor.organizationId, ownerUserId: actor.id, professionalUserId: 'professional',
    ownerNodeId: 'owner', workflowVersionId: 'published', rowVersion: 4, contentVersion: 2, instanceVersion: 3,
    analysisDueAt: '2026-10-25T00:00:00Z', submissionDueAt: '2026-10-26T00:00:00Z', closureDueAt: '2026-11-01T00:00:00Z' as string | null,
    submittedAt: '2026-10-26T00:00:00Z', analysisCompletedAt: '2026-10-25T00:00:00Z', closedAt: null as string | null };
  const record = { problem: { id: problemId, organizationId: actor.organizationId, reportNumber: '8D-1', get ownerId() { return c.ownerUserId; }, get closedAt() { return c.closedAt; } },
    report: { get professionalUserId() { return c.professionalUserId; }, closedRevisionId: null }, node: { type: 'APPROVAL', config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'process-quality' } } },
    instance: { status: 'RUNNING', currentNodeId: 'review' } };
  let workflowAllowed = true;
  const tx = { $queryRaw: async (sql: { strings: string[] }) => [{ allowed: !sql.strings.join('').includes('assigneeUserId') || workflowAllowed }],
    user: { findUnique: async () => ({ ...actor, status: 'ACTIVE', organization: { status: 'ACTIVE' } }) },
    organization: { findUnique: async () => ({ status: 'ACTIVE' }) } };
  const reports = Object.assign(Object.create(ProcessEightDService.prototype) as ProcessEightDService, { taskCandidates: async () => [{ problemId }], lockRecord: async () => record,
    authorizeRead: jest.fn(async () => {}), authorizeEdit: jest.fn(async () => { throw new HttpException('review locked', 409); }),
    authorizeDeadlineRequest: jest.fn(async () => {}), deadlineContext: async () => c,
    feature: async () => false });
  const requests: { stage: string; status: string }[] = [];
  const extensions = { candidateProblemIds: async () => [], readProjection: async () => requests,
    policyCurrent: jest.fn(async () => true), eligible: jest.fn(async () => []) };
  Object.assign(reports, { extensions });
  const rounds = { assertActor: jest.fn(async () => {}) };
  const service = new ProcessEightDTaskService({ $transaction: async (work: (tx: unknown) => unknown) => work(tx) } as never,
    reports as never, extensions as never, rounds as never, {} as never);
  return { service, c, record, reports, extensions, requests, rounds, tx, revokeWorkflow: () => { workflowAllowed = false; } };
}

describe('approval owner deadline request projection (no AppModule or document source)', () => {
  it('projects only closure extension eligibility, never a handling/submit task during review', async () => {
    const f = fixture();
    expect(await f.service.list(actor, {})).toMatchObject({ total: 1, items: [{ kind: 'EXTENSION_REQUEST', status: 'AVAILABLE',
      stage: 'CLOSURE', extensionStages: ['CLOSURE'], actions: ['OPEN_REPORT', 'REQUEST_EXTENSION'] }] });
    expect(f.reports.authorizeEdit).not.toHaveBeenCalled();
    expect(f.reports.authorizeDeadlineRequest).toHaveBeenCalled();
  });

  it('projects the same real report action without save, submit or reassignment', async () => {
    const f = fixture();
    expect(await f.reports.allowedActions(f.tx as never, actor, f.record as never)).toEqual(['read', 'request-extension']);
    f.requests.push({ stage: 'CLOSURE', status: 'LEADER_PENDING' });
    expect(await f.reports.allowedActions(f.tx as never, actor, f.record as never)).toEqual(['read']);
  });

  it.each(['other', 'collaborator', 'professional', 'no-deadline', 'closed', 'stopped', 'policy', 'pending', 'work-revoked', 'workflow-revoked'])('does not project %s eligibility', async reason => {
    const f = fixture();
    if (reason === 'other' || reason === 'collaborator') f.c.ownerUserId = reason;
    if (reason === 'professional') f.c.professionalUserId = actor.id;
    if (reason === 'no-deadline') f.c.closureDueAt = null;
    if (reason === 'closed') f.c.closedAt = '2026-10-26T00:00:00Z';
    if (reason === 'stopped') f.record.instance.status = 'COMPLETED';
    if (reason === 'policy') f.extensions.policyCurrent.mockResolvedValue(false);
    if (reason === 'pending') f.requests.push({ stage: 'CLOSURE', status: 'QUALITY_PENDING' });
    if (reason === 'work-revoked') f.reports.authorizeDeadlineRequest.mockRejectedValue(new HttpException('revoked', 403));
    if (reason === 'workflow-revoked') f.revokeWorkflow();
    expect((await f.service.list(actor, {})).items).toEqual([]);
  });

  it('revalidates owner appointment after extension duties resolve', async () => {
    const f = fixture();
    f.extensions.eligible.mockImplementation(async () => {
      f.reports.authorizeDeadlineRequest.mockRejectedValue(new HttpException('expired', 403)); return [];
    });
    expect((await f.service.list(actor, {})).items).toEqual([]);
    expect(f.reports.authorizeDeadlineRequest.mock.calls.length).toBeGreaterThan(1);
  });

  it('propagates revoked sessions instead of returning eligibility', async () => {
    const f = fixture(); f.rounds.assertActor.mockRejectedValue(new HttpException('expired', 401));
    await expect(f.service.list(actor, {})).rejects.toMatchObject({ status: 401 });
  });
});
