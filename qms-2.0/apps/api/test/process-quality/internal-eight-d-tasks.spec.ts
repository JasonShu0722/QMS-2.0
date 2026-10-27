import 'reflect-metadata';
import { jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { Prisma } from '../../src/generated/prisma/client.js';
import { INTERNAL_EIGHT_D_DOMAINS } from '../../src/common/eight-d/internal-eight-d-domain.js';
import * as reminderHelpers from '../../src/common/eight-d/internal-eight-d-reminder.js';
import type { AtomicOutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import { ProcessEightDReminderService } from '../../src/modules/process-quality/process-eight-d-reminder.service.js';
import { ProcessEightDTaskService } from '../../src/modules/process-quality/process-eight-d-task.service.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-10-27T00:00:00Z');
const actor = { id: id(6), organizationId: id(1), accountType: 'INTERNAL', sessionId: id(20) } as const;
const domains = Object.entries(INTERNAL_EIGHT_D_DOMAINS);
type Domain = (typeof INTERNAL_EIGHT_D_DOMAINS)[keyof typeof INTERNAL_EIGHT_D_DOMAINS];

function fixture(domain: Domain, explicit = true) {
  const c = { organizationId: id(1), problemId: id(2), instanceId: id(3), workflowVersionId: id(4), ownerNodeId: id(5),
    ownerUserId: actor.id, professionalUserId: id(7), responsibleSectionDepartmentId: id(8), analysisDueAt: new Date(now.getTime() - 3600000).toISOString(),
    analysisCompletedAt: null, submittedAt: null, closedAt: null, rowVersion: 2, contentVersion: 3, instanceVersion: 4,
    policy: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 } };
  const request = { id: id(9), version: 1, status: 'LEADER_PENDING', stage: 'ANALYSIS', applicantUserId: c.ownerUserId,
    originalDueAt: c.analysisDueAt, updatedAt: now.toISOString(), createdAt: now.toISOString() };
  const writes: Array<{ text: string; values: unknown[] }> = [];
  const queries: string[] = [];
  const notificationRows: unknown[] = [];
  const locks: Array<{ tx: object; problemId: string; actor: unknown }> = [];
  let storedDomain = domain;
  let inserted = true;
  const query = async (input: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
    const sql = Array.isArray(input) ? Prisma.sql(input as TemplateStringsArray, ...values) : input as Prisma.Sql;
    const text = sql.sql; queries.push(text);
    if (text.includes('FROM problem_indexes')) return [{ allowed: sql.values.includes(storedDomain.domainCode) && sql.values.includes(storedDomain.sourceType) }];
    return text.includes('_eight_d_notifications') ? notificationRows : [{ allowed: true }];
  };
  const tx = { $queryRaw: query, $executeRaw: async (input: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
    const sql = Array.isArray(input) ? Prisma.sql(input as TemplateStringsArray, ...values) : input as Prisma.Sql;
    writes.push({ text: sql.sql, values: sql.values }); return inserted ? 1 : 0;
  }, workflowInstance: { findFirst: async () => ({ currentNodeId: c.ownerNodeId }) },
  problemIndex: { findFirstOrThrow: async () => ({ reportNumber: '8D-N4' }) },
  user: { findUnique: async () => ({ ...actor, status: 'ACTIVE', organization: { status: 'ACTIVE' } }) },
  organization: { findUnique: async () => ({ status: 'ACTIVE' }) } };
  const prisma = { $transaction: async (work: (t: typeof tx) => unknown) => work({ ...tx }) };
  const reports = { domain, reminderCandidates: async () => [{ organizationId: c.organizationId, problemId: c.problemId }],
    notificationContext: jest.fn(async () => c), canNotifyRecipient: jest.fn(async () => true),
    taskCandidates: async () => [id(2), id(12)].map(problemId => ({ problemId })),
    lockRecord: jest.fn(async (tx: object, actor: unknown, problemId: string) => { locks.push({ tx, actor, problemId });
      return { problem: { id: problemId, reportNumber: '8D-N4' }, instance: { status: 'RUNNING', currentNodeId: c.ownerNodeId } }; }),
    authorizeRead: jest.fn(async (_tx: unknown, _actor: unknown, _record: { problem: { id: string } }) => {}), authorizeEdit: jest.fn(async () => {}), deadlineRequestStages: jest.fn(async (): Promise<('ANALYSIS' | 'CLOSURE')[]> => ['ANALYSIS']),
    deadlineContext: async (_tx: unknown, r: { problem: { id: string } }) => ({ ...c, problemId: r.problem.id }) };
  const selection = { current: jest.fn(async () => true), currentParticipant: jest.fn(async () => true) };
  const extensions = { candidateProblemIds: async () => [], eligible: jest.fn(async () => []),
    selectParticipants: async () => selection, reconcile: jest.fn(async () => [request]), policyCurrent: async () => true,
    readProjection: async () => [request], pendingUser: () => id(10) };
  const rounds = { assertActor: jest.fn(async () => {}), readProjection: jest.fn(async (): Promise<unknown> => null), notificationRecipients: async () => [id(10)] };
  const enqueue = jest.fn(async (_event: unknown, _tx: unknown) => {});
  const reminders = Reflect.construct(ProcessEightDReminderService, [prisma, reports, extensions, rounds, { enqueue }, ...(explicit ? [domain] : [])]) as ProcessEightDReminderService;
  const tasks = Reflect.construct(ProcessEightDTaskService, [prisma, reports, extensions, rounds, reminders, ...(explicit ? [domain] : [])]) as ProcessEightDTaskService;
  const event = { eventType: 'WORKFLOW_DEADLINE_EXTENSION_CHANGED', aggregateType: 'WorkflowDeadlineExtension', aggregateId: request.id,
    eventKey: `deadline:${request.id}:1`, payload: { schemaVersion: 1, organizationId: c.organizationId, problemId: c.problemId, requestId: request.id, requestVersion: 1 } };
  return { c, tx, reminders, tasks, writes, queries, notificationRows, locks, reports, selection, extensions, rounds, enqueue, event, request,
    setStoredDomain: (value: Domain) => { storedDomain = value; }, duplicateSlot: () => { inserted = false; } };
}

describe.each(domains)('%s internal 8D tasks/reminders (pure service tests, no PostgreSQL)', (key, domain) => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
  afterEach(() => jest.useRealTimers());

  it('owns its slot, event identity, aggregate and notification table', async () => {
    const f = fixture(domain);
    await f.reminders.poll(1, now);
    const event = f.enqueue.mock.calls[0][0] as { eventType: string; aggregateType: string; eventKey: string };
    expect(event).toMatchObject({ eventType: `${key}_EIGHT_D_REMINDER_DUE`, aggregateType: `${domain.revisionType.replace('Revision', '')}Reminder`,
      eventKey: expect.stringMatching(new RegExp(`^${key === 'PROCESS' ? 'eight-d' : domain.resourceType}:`)) });
    expect(f.writes[0].text).toContain(`INSERT INTO ${domain.storagePrefix}_reminder_slots`);
    f.writes.length = 0;
    await f.reminders.handle(f.tx as never, event as never);
    expect(f.writes).toHaveLength(2);
    expect(f.writes.every(w => w.text.includes(`INSERT INTO ${domain.storagePrefix}_notifications`))).toBe(true);
    expect(f.writes.map(w => w.values[3]).sort()).toEqual([f.c.ownerUserId, f.c.professionalUserId].sort());
    expect(f.writes[0].text).not.toContain('delivered_at');
    f.duplicateSlot();
    await f.reminders.poll(1, now);
    expect(f.enqueue).toHaveBeenCalledTimes(1);
  });

  it('defers another domain extension without reconciling or projecting it', async () => {
    const f = fixture(domain); f.setStoredDomain(domain === INTERNAL_EIGHT_D_DOMAINS.CUSTOMER ? INTERNAL_EIGHT_D_DOMAINS.PROCESS : INTERNAL_EIGHT_D_DOMAINS.CUSTOMER);
    expect(await f.reminders.handle(f.tx as never, f.event as never)).toBe('deferred');
    expect(f.reports.notificationContext).not.toHaveBeenCalled();
    expect(f.extensions.reconcile).not.toHaveBeenCalled(); expect(f.writes).toHaveLength(0);
  });

  it('preserves immediate extension delivery and expires saved notices using the captured selection', async () => {
    const f = fixture(domain);
    await f.reminders.handle(f.tx as never, f.event as never);
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0].text).toContain(`${domain.storagePrefix}_notifications`);
    const saved = JSON.parse(f.writes[0].values.at(-1) as string);
    const visible = await f.reminders.notificationVisibility(f.tx as never, f.c as never, id(10));
    expect(await visible(saved)).toBe(true);
    f.selection.current.mockResolvedValue(false);
    expect(await visible(saved)).toBe(false);
    f.writes.length = 0;
    await f.reminders.handle(f.tx as never, f.event as never);
    expect(f.writes).toHaveLength(0);
  });

  it('queries only its notification table and filters actual report read denial before pagination', async () => {
    const f = fixture(domain);
    for (const problemId of [id(2), id(12)]) f.notificationRows.push({ id: problemId, problemId, kind: 'HANDLING_REMINDER',
      subject: 'subject', body: 'body', context: {}, deliveredAt: now });
    f.reports.authorizeRead.mockRejectedValue(new HttpException('source/read denied', 403));
    expect(await f.tasks.notifications(actor, { pageSize: 1 })).toEqual({ total: 0, items: [] });
    expect(f.queries.some(q => q.includes(`FROM ${domain.storagePrefix}_notifications`))).toBe(true);
    expect(f.locks).toHaveLength(2);
    expect(new Set(f.locks.map(l => l.tx)).size).toBe(2);
    expect(f.locks.every(l => l.actor === actor)).toBe(true);
  });

  it('uses the current actor and per-problem transactions, and rechecks handling plus extension expiry', async () => {
    const f = fixture(domain);
    let expired = false;
    f.extensions.eligible.mockImplementation(async () => { expired = true; return []; });
    f.reports.authorizeEdit.mockImplementation(async () => { if (expired) throw new HttpException('appointment expired', 403); });
    f.reports.deadlineRequestStages.mockImplementation(async () => expired ? [] : ['ANALYSIS']);
    expect(await f.tasks.list(actor, {})).toEqual({ total: 0, items: [] });
    expect(new Set(f.locks.map(l => l.tx)).size).toBe(2);
    expect(f.locks.every(l => l.actor === actor)).toBe(true);
  });

  it('counts only authorized tasks before slicing the page, without dropping the next visible problem', async () => {
    const f = fixture(domain);
    f.reports.authorizeRead.mockImplementation(async (_tx, actualActor, record) => {
      expect(actualActor).toBe(actor);
      if (record.problem.id === id(2)) throw new HttpException('source denied', 403);
    });
    expect(await f.tasks.list(actor, { pageSize: 1 })).toMatchObject({ total: 1, items: [{ problemId: id(12), kind: 'HANDLING' }] });
  });

  it('rejects invalid event envelopes before domain lookup and keeps retryable transaction failures', async () => {
    const f = fixture(domain);
    await expect(f.reminders.handle(f.tx as never, { ...f.event, aggregateId: id(30) } as never)).rejects.toThrow(`${key}_EIGHT_D_REMINDER_EVENT_INVALID`);
    expect(f.queries).toHaveLength(0);
    f.reports.lockRecord.mockRejectedValueOnce({ code: 'P2010', meta: { code: '40P01' } });
    await expect(f.tasks.list(actor, {})).rejects.toMatchObject({ status: 409 });
    f.rounds.assertActor.mockRejectedValue(new HttpException('session expired', 401));
    await expect(f.tasks.notifications(actor, {})).rejects.toMatchObject({ status: 401 });
  });

  it('routes a shared extension exactly once even when its owner is not the first registered handler', async () => {
    const fixtures = Object.values(INTERNAL_EIGHT_D_DOMAINS).map(d => fixture(d));
    const owner = fixtures[Object.values(INTERNAL_EIGHT_D_DOMAINS).indexOf(domain)];
    const handler = combine(fixtures.map(f => f.reminders));
    expect(handler.eventTypes).toHaveLength(4);
    expect(await handler.handle(owner.tx as never, owner.event as never)).toBeUndefined();
    expect(owner.writes).toHaveLength(1);
    expect(fixtures.filter(f => f !== owner).every(f => f.reports.notificationContext.mock.calls.length === 0)).toBe(true);
    expect(owner.extensions.reconcile).toHaveBeenCalledTimes(1);
    expect(owner.writes[0].text).toContain(`${domain.storagePrefix}_notifications`);
  });

  it('projects cancellations only for the still-current owner and preserves history/version facts', async () => {
    const f = fixture(domain); f.request.status = 'CANCELLED';
    f.extensions.reconcile.mockResolvedValue([]);
    await f.reminders.handle(f.tx as never, f.event as never);
    expect(f.writes).toHaveLength(1);
    const saved = JSON.parse(f.writes[0].values.at(-1) as string);
    expect(saved).toMatchObject({ kind: 'EXTENSION_CANCELLED', requestId: f.request.id, requestVersion: 1, dueAt: f.request.originalDueAt, slot: null });
    f.writes.length = 0; f.c.ownerUserId = id(30);
    await f.reminders.handle(f.tx as never, f.event as never);
    expect(f.writes).toHaveLength(0);
  });

  it('rechecks the captured closure duty before inserting, and never duplicates one person across handling duties', async () => {
    const f = fixture(domain); f.c.professionalUserId = f.c.ownerUserId;
    await f.reminders.poll(1, now);
    await f.reminders.handle(f.tx as never, f.enqueue.mock.calls[0][0] as never);
    expect(f.writes.filter(w => w.text.includes('_notifications'))).toHaveLength(1);
    Object.assign(f.c, { submittedAt: now.toISOString(), closureDueAt: f.c.analysisDueAt });
    f.tx.workflowInstance.findFirst = async () => ({ currentNodeId: 'closure' });
    f.rounds.readProjection.mockResolvedValue({ id: id(21), version: 2, status: 'PENDING', duties: [{ userId: id(10), status: 'PENDING', participant: { userId: id(10), bindingId: id(22) } }] });
    await f.reminders.poll(1, now);
    const event = f.enqueue.mock.calls[1][0];
    f.writes.length = 0; f.selection.currentParticipant.mockResolvedValue(false);
    await f.reminders.handle(f.tx as never, event as never);
    expect(f.selection.currentParticipant).toHaveBeenCalled(); expect(f.writes).toHaveLength(0);
  });
});

it('keeps five-argument PROCESS construction and rejects non-whitelisted descriptors', () => {
  const f = fixture(INTERNAL_EIGHT_D_DOMAINS.PROCESS, false);
  expect(f.reminders.eventTypes).toContain('PROCESS_EIGHT_D_REMINDER_DUE');
  expect(() => fixture({ ...INTERNAL_EIGHT_D_DOMAINS.CUSTOMER })).toThrow('INTERNAL_EIGHT_D_DOMAIN_INVALID');
  expect(() => Reflect.construct(ProcessEightDTaskService, [null, null, null, null, null, { ...INTERNAL_EIGHT_D_DOMAINS.CUSTOMER }])).toThrow('INTERNAL_EIGHT_D_DOMAIN_INVALID');
});

function combine(handlers: AtomicOutboxHandler[]): AtomicOutboxHandler {
  const factory = Reflect.get(reminderHelpers, 'internalEightDReminderHandler');
  expect(factory).toBeInstanceOf(Function);
  return factory(handlers);
}

it('leaves unowned events deferred rather than marking them processed', async () => {
  const f = fixture(INTERNAL_EIGHT_D_DOMAINS.PROCESS); f.setStoredDomain(INTERNAL_EIGHT_D_DOMAINS.CUSTOMER);
  expect(await combine([f.reminders]).handle(f.tx as never, f.event as never)).toBe('deferred');
  expect(await combine([f.reminders]).handle(f.tx as never, { ...f.event, eventType: 'UNRELATED' } as never)).toBe('deferred');
  expect(f.writes).toHaveLength(0);
});

it('stops after an owned but obsolete event and propagates a handler failure atomically', async () => {
  const obsolete = { eventTypes: ['PROCESS_EIGHT_D_REMINDER_DUE'], handle: jest.fn<AtomicOutboxHandler['handle']>().mockResolvedValue(undefined) };
  const next = { eventTypes: obsolete.eventTypes, handle: jest.fn<AtomicOutboxHandler['handle']>().mockResolvedValue(undefined) };
  const event = { eventType: obsolete.eventTypes[0] } as never;
  await combine([obsolete, next]).handle({} as never, event);
  expect(next.handle).not.toHaveBeenCalled();
  obsolete.handle.mockRejectedValue(new Error('projection failed'));
  await expect(combine([obsolete, next]).handle({} as never, event)).rejects.toThrow('projection failed');
  expect(next.handle).not.toHaveBeenCalled();
});
