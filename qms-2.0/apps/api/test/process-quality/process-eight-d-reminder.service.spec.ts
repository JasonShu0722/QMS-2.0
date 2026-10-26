import 'reflect-metadata';
import { jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { ProcessEightDReminderService } from '../../src/modules/process-quality/process-eight-d-reminder.service.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-10-25T00:00:00Z');
function fixture() {
  const c = { organizationId: id(1), problemId: id(2), instanceId: id(3), workflowVersionId: id(4), ownerNodeId: id(5), ownerUserId: id(6),
    professionalUserId: id(7), responsibleSectionDepartmentId: id(8), submittedAt: now.toISOString(), closedAt: null, closureDueAt: new Date(now.getTime() - 48 * 3600000).toISOString(),
    policy: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 } };
  const request = { id: id(9), version: 1, status: 'LEADER_PENDING', stage: 'ANALYSIS', applicantUserId: c.ownerUserId,
    originalDueAt: now.toISOString(), updatedAt: now.toISOString() };
  const writes: unknown[][] = [];
  const tx = { $queryRaw: async () => [{ allowed: true }], $executeRaw: async (_strings: unknown, ...values: unknown[]) => { writes.push(values); return 1; },
    workflowInstance: { findFirst: async () => ({ currentNodeId: 'closure' }) }, problemIndex: { findFirstOrThrow: async () => ({ reportNumber: 'N3' }) } };
  const reports = { reminderCandidates: async () => [{ problemId: c.problemId, organizationId: c.organizationId }],
    notificationContext: jest.fn(async () => c), canNotifyRecipient: async () => true };
  const selection = { plan: {}, current: jest.fn(async () => true), currentParticipant: jest.fn(async (_participant: unknown) => true) };
  const extensions = { reconcile: async () => [request], readProjection: async () => [request], policyCurrent: async () => true,
    pendingUser: () => id(10), selectParticipants: jest.fn(async () => selection) };
  const rounds = { readProjection: jest.fn(async (): Promise<unknown> => null), notificationRecipients: async () => [id(10)] };
  const enqueue = jest.fn(async (_event: unknown, _tx: unknown) => {});
  const reminders = new ProcessEightDReminderService({ $transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx) } as never,
    reports as never, extensions as never, rounds as never, { enqueue } as never);
  const event = { eventType: 'WORKFLOW_DEADLINE_EXTENSION_CHANGED', aggregateType: 'WorkflowDeadlineExtension', aggregateId: request.id,
    eventKey: `deadline:${request.id}:1`, payload: { schemaVersion: 1, organizationId: c.organizationId, problemId: c.problemId, requestId: request.id, requestVersion: 1 } };
  return { reminders, tx, reports, c, request, event, writes, enqueue, selection, extensions, rounds };
}

describe('process reminder cadence and final qualification regressions (no database)', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
  afterEach(() => jest.useRealTimers());

  it('keeps the immediate extension-change notification but waits a full interval before periodic delivery', async () => {
    const f = fixture();
    await f.reminders.handle(f.tx as never, f.event as never);
    expect(f.writes).toHaveLength(1);
    expect((await f.reminders.poll(1, now)).enqueued).toBe(0);
    expect((await f.reminders.poll(1, new Date(now.getTime() + 24 * 3600000 - 1))).enqueued).toBe(0);
    expect(f.enqueue).not.toHaveBeenCalled();
    expect((await f.reminders.poll(1, new Date(now.getTime() + 24 * 3600000))).enqueued).toBe(1);
  });

  it('does not swallow a concurrency conflict in the maintenance cycle', async () => {
    const f = fixture(); f.reports.notificationContext.mockRejectedValue(new HttpException('CONCURRENCY_CONFLICT', 409));
    await expect(f.reminders.poll(1, now)).rejects.toMatchObject({ status: 409 });
  });

  it('rechecks captured extension sources immediately before inserting a notification', async () => {
    const f = fixture();
    f.selection.current.mockImplementation(async () => false);
    await f.reminders.handle(f.tx as never, f.event as never);
    expect(f.writes).toHaveLength(0);
  });

  it('filters saved notices after source expiry using one captured resolver selection for the problem', async () => {
    const f = fixture();
    await f.reminders.handle(f.tx as never, f.event as never);
    const saved = JSON.parse(f.writes[0].at(-1) as string);
    const visible = await f.reminders.notificationVisibility(f.tx as never, f.c as never, id(10));
    expect(await visible(saved)).toBe(true);
    f.selection.current.mockResolvedValue(false);
    expect(await visible(saved)).toBe(false);
    expect(f.extensions.selectParticipants).toHaveBeenCalledTimes(2);
  });

  it('rechecks a captured closure management source after the N2 recipient projection', async () => {
    const f = fixture();
    f.rounds.readProjection.mockResolvedValue({ id: id(11), version: 1, status: 'PENDING', duties: [{ userId: id(10), status: 'PENDING', participant: { userId: id(10), bindingId: id(12) } }] });
    await f.reminders.poll(1, now);
    const event = f.enqueue.mock.calls[0][0];
    f.writes.length = 0;
    f.selection.currentParticipant.mockResolvedValue(false);
    await f.reminders.handle(f.tx as never, event as never);
    expect(f.selection.currentParticipant).toHaveBeenCalled();
    expect(f.writes).toHaveLength(0);
  });
});
