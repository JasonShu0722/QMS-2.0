import 'reflect-metadata';
import { jest } from '@jest/globals';
import { WorkflowDeadlineExtensionService } from '../../src/modules/workflow/workflow-deadline-extension.service.js';
import type { WorkflowDeadlineContext } from '../../src/modules/workflow/workflow-deadline-extension.types.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-10-25T00:00:00Z');
function fixture() {
  const c: WorkflowDeadlineContext = { organizationId: id(1), problemId: id(2), instanceId: id(3), workflowVersionId: id(4), ownerNodeId: id(5),
    ownerUserId: id(6), professionalUserId: id(7), responsibleSectionDepartmentId: id(8), rowVersion: 1, contentVersion: 1, instanceVersion: 1,
    analysisDueAt: '2026-10-24T00:00:00.000Z', submissionDueAt: null, closureDueAt: null, analysisCompletedAt: null, submittedAt: null, closedAt: null,
    policy: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 } };
  const leader = { userId: id(9), assignmentId: id(10), positionId: id(11), departmentId: id(8), bindingId: id(12), bindingVersion: 1, scopeId: null, scopeVersion: null };
  const plan = { leader, professional: { userId: c.professionalUserId, assignmentId: null, positionId: null, departmentId: null, bindingId: null, bindingVersion: null, scopeId: null, scopeVersion: null }, leaderSkipped: false };
  const row = { id: id(13), organizationId: c.organizationId, problemId: c.problemId, workflowVersionId: c.workflowVersionId, stage: 'ANALYSIS',
    originalDueAt: new Date(c.analysisDueAt!), requestedDueAt: new Date('2026-10-30'), originallyOverdue: true, reason: 'test', applicantUserId: c.ownerUserId,
    context: c, participants: plan, status: 'LEADER_PENDING', version: 1, history: [], createdAt: now, updatedAt: now };
  let pending = true;
  const writes: Array<{ text: string; values: unknown[] }> = [];
  const tx = {
    $queryRaw: async (sql: { strings?: readonly string[] } | readonly string[]) => {
      const text = ('strings' in sql ? sql.strings! : sql as readonly string[]).join('');
      return text.includes('FROM workflow_deadline_extensions') ? (pending ? [row] : []) : text.includes('receipts') ? [] : [{ allowed: true }];
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { writes.push({ text: strings.join(''), values }); return 1; },
    userPosition: { findFirst: async (_query: { where: { userId: string } }): Promise<{ id: string } | null> => ({ id: id(10) }) },
    problemIndex: { findFirst: async () => ({ id: c.problemId, domainCode: 'fixture', ownerId: c.ownerUserId, workflowInstanceId: c.instanceId }) },
    workflowNode: { findFirst: async () => ({ id: c.ownerNodeId, type: 'ACTION', config: { isStart: true, processEightD: c.policy } }) },
    workflowInstance: { findFirst: async () => ({ id: c.instanceId, organizationId: c.organizationId, status: 'RUNNING', workflowVersionId: c.workflowVersionId, version: 1,
      workflowVersion: { status: 'PUBLISHED', organizationId: c.organizationId }, currentNodeId: c.ownerNodeId,
      currentNode: { organizationId: c.organizationId, workflowVersionId: c.workflowVersionId } }) },
  };
  const management = { organizationId: c.organizationId, sectionDepartmentId: c.responsibleSectionDepartmentId, at: now,
    responsibilities: [{ ...leader, responsibility: 'SECTION_MANAGER' }], issues: [] };
  const responsibilities = {
    resolveManagementResponsibilities: jest.fn(async () => management),
    revalidateLockedManagementResponsibilities: jest.fn(async (_tx: unknown, _management: unknown, at: Date) =>
      new Set(at.getTime() < now.getTime() + 1000 ? [leader.bindingId] : [])),
  };
  const adapter = { lockAndRead: async () => c, deadlineContext: jest.fn(async () => c), applyDeadlineExtension: async () => {} };
  const service = new WorkflowDeadlineExtensionService({ $transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx) } as never,
    { record: async () => {} } as never, responsibilities as never, { get: () => adapter } as never,
    { assertActor: async () => {} } as never, { enqueue: async () => {} } as never);
  return { service, tx, c, leader, responsibilities, adapter, writes, management, row, noPending: () => { pending = false; } };
}

describe('deadline captured-source and timestamp regressions (no database)', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
  afterEach(() => jest.useRealTimers());

  it('filters an approval whose captured responsibility expires during the final adapter read without resolving new locks', async () => {
    const f = fixture();
    f.adapter.deadlineContext.mockImplementationOnce(async () => f.c).mockImplementationOnce(async () => { jest.setSystemTime(new Date(now.getTime() + 2000)); return f.c; });
    const rows = await f.service.eligible(f.tx as never, { id: f.leader.userId, organizationId: f.c.organizationId, accountType: 'INTERNAL', sessionId: id(14) }, f.c.problemId);
    expect(rows).toEqual([]);
    expect(f.responsibilities.resolveManagementResponsibilities).toHaveBeenCalledTimes(1);
    expect(f.responsibilities.revalidateLockedManagementResponsibilities.mock.calls.at(-1)?.[2].getTime()).toBe(now.getTime() + 2000);
  });

  it('persists the exact post-lock JS creation/update times rather than transaction-start SQL defaults', async () => {
    const f = fixture(); f.noPending();
    const r = await f.service.request({ id: f.c.ownerUserId, organizationId: f.c.organizationId, accountType: 'INTERNAL', sessionId: id(14) }, f.c.problemId,
      { expectedRowVersion: 1, expectedInstanceVersion: 1, stage: 'ANALYSIS', requestedDueAt: '2026-10-30', reason: 'explicit' }, 'request-key-1', 'trace');
    const insert = f.writes.find(w => w.text.includes('INSERT INTO workflow_deadline_extensions'))!;
    expect(insert.text).toMatch(/created_at, updated_at/);
    expect(insert.values.slice(-2)).toEqual([new Date(r.createdAt), new Date(r.updatedAt)]);
  });

  it.each(['OWNER', 'QUALITY'] as const)('revalidates the %s appointment as well as feature/session permissions', async side => {
    const f = fixture();
    f.responsibilities.revalidateLockedManagementResponsibilities.mockImplementation(async () => new Set([f.leader.bindingId]));
    const expiresUser = side === 'OWNER' ? f.c.ownerUserId : f.c.professionalUserId;
    f.tx.userPosition.findFirst = async query => {
      return query.where.userId === expiresUser && Date.now() > now.getTime() ? null : { id: id(10) };
    };
    f.adapter.deadlineContext.mockImplementationOnce(async () => f.c).mockImplementationOnce(async () => { jest.setSystemTime(new Date(now.getTime() + 2000)); return f.c; });
    expect(await f.service.eligible(f.tx as never, { id: f.leader.userId, organizationId: f.c.organizationId, accountType: 'INTERNAL', sessionId: id(14) }, f.c.problemId)).toEqual([]);
    expect(f.responsibilities.resolveManagementResponsibilities).toHaveBeenCalledTimes(1);
  });
});
