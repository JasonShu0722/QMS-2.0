import 'reflect-metadata';
import { jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { ProcessEightDTaskService } from '../../src/modules/process-quality/process-eight-d-task.service.js';

const actor = { id: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-000000000002', accountType: 'INTERNAL', sessionId: '00000000-0000-4000-8000-000000000003' } as const;
const ids = ['00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000005'];

function fixture() {
  const locks: Array<{ tx: object; problemId: string }> = [];
  const rows = [ids[0], ids[0], ids[1]].map((problemId, i) => ({ id: String(i), problemId, kind: 'HANDLING_REMINDER', subject: 'subject', body: 'body', context: {}, deliveredAt: new Date() }));
  const prisma = { $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
    $queryRaw: async (sql: { strings: string[] }) => sql.strings.join('').includes('process_eight_d_notifications') ? rows : [{ allowed: true }],
    user: { findUnique: async () => ({ ...actor, status: 'ACTIVE', organization: { status: 'ACTIVE' } }) },
    organization: { findUnique: async () => ({ status: 'ACTIVE' }) },
  }) };
  const c = { organizationId: actor.organizationId, ownerUserId: actor.id, professionalUserId: ids[1], analysisDueAt: new Date(0).toISOString(), policy: null,
    submittedAt: null, closedAt: null, analysisCompletedAt: null, ownerNodeId: 'owner' };
  const reports = {
    taskCandidates: async () => ids.map(problemId => ({ problemId })),
    lockRecord: jest.fn(async (tx: object, _actor: unknown, problemId: string) => {
      locks.push({ tx, problemId });
      return { problem: { id: problemId, reportNumber: problemId }, instance: { status: 'RUNNING', currentNodeId: 'owner' } };
    }),
    authorizeRead: jest.fn(async () => {}), authorizeEdit: jest.fn(async () => {}),
    deadlineRequestStages: async () => [],
    deadlineContext: async (_tx: unknown, record: { problem: { id: string } }) => ({ ...c, problemId: record.problem.id }),
  };
  const extensions = { candidateProblemIds: async () => [], readProjection: async () => [], policyCurrent: async () => false, eligible: jest.fn(async () => []) };
  const reminders = { notificationVisibility: async () => async () => true };
  const service = new ProcessEightDTaskService(prisma as never, reports as never, extensions as never, { assertActor: async () => {} } as never, reminders as never);
  return { service, locks, reports, extensions };
}

describe('process inbox transaction and final authorization regressions (no database)', () => {
  it.each(['list', 'notifications'] as const)('%s never retains one problem locks while acquiring another problem', async method => {
    const f = fixture();
    await f.service[method](actor, {});
    expect(new Set(f.locks.map(lock => lock.problemId)).size).toBe(2);
    for (const tx of new Set(f.locks.map(lock => lock.tx))) {
      expect(new Set(f.locks.filter(lock => lock.tx === tx).map(lock => lock.problemId)).size).toBe(1);
    }
  });

  it.each(['list', 'notifications'] as const)('%s propagates transaction conflicts instead of returning a partial invisible list', async method => {
    const f = fixture();
    f.reports.lockRecord.mockRejectedValueOnce(new HttpException({ code: 'CONCURRENCY_CONFLICT' }, 409));
    await expect(f.service[method](actor, {})).rejects.toMatchObject({ status: 409 });
  });

  it.each(['list', 'notifications'] as const)('%s surfaces a real driver deadlock code as a 409', async method => {
    const f = fixture();
    f.reports.lockRecord.mockRejectedValueOnce({ code: 'P2010', meta: { code: '40P01' } });
    await expect(f.service[method](actor, {})).rejects.toMatchObject({ status: 409 });
  });

  it('filters handling tasks when owner appointment expires while resolving extension duties', async () => {
    const f = fixture();
    let expired = false;
    f.extensions.eligible.mockImplementation(async () => { expired = true; return []; });
    f.reports.authorizeEdit.mockImplementation(async () => { if (expired) throw new HttpException('expired appointment', 403); });
    expect((await f.service.list(actor, {})).total).toBe(0);
    expect(f.reports.authorizeEdit.mock.calls.length).toBeGreaterThan(2);
  });
});
