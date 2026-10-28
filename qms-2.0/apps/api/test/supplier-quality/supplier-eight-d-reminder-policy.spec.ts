import { supplierHandlingStage, supplierReminderSlot, supplierReminderPlans, supplierReminderEvent, supplierReminderPayload, supplierProjectionPlans, supplierChangePayload, supplierDeadlineChangePayload } from '../../src/modules/supplier-quality/supplier-eight-d-reminder.policy.js';
import type { SupplierEightDTaskContext, SupplierEightDClosurePending, SupplierEightDDeadlinePending } from '../../src/modules/supplier-quality/supplier-eight-d-task.types.js';

const now = new Date('2026-10-28T10:00:00Z');
const context = (extra: Partial<SupplierEightDTaskContext> = {}): SupplierEightDTaskContext => ({
  organizationId: '00000000-0000-4000-8000-000000000001', supplierProblemId: '00000000-0000-4000-8000-000000000002',
  problemId: '00000000-0000-4000-8000-000000000003', reportNumber: 'S8D-1', instanceId: 'instance', workflowVersionId: 'workflow',
  rowVersion: 1, contentVersion: 1, instanceVersion: 1, handling: true, replyMode: 'SUPPLIER', supplierOrganizationId: 'supplier',
  releasedToSupplierAt: '2026-10-27T00:00:00Z', handlingUserIds: ['supplier-user'], analysisDueAt: '2026-10-28T08:00:00Z',
  analysisCompletedAt: null, submissionDueAt: '2026-10-28T09:00:00Z', closureDueAt: '2026-10-28T09:00:00Z',
  submittedRevisionId: null, closedAt: null, reminderEveryHours: 1, ...extra,
});
const closure: SupplierEightDClosurePending = { roundId: 'round', roundVersion: 3, duties: [
  { duty: 'PROFESSIONAL', userId: 'sqe', status: 'APPROVED' }, { duty: 'SECTION_MANAGER', userId: 'manager', status: 'PENDING' },
  { duty: 'MINISTER', userId: 'minister', status: 'WAITING' },
] };
const extension = (extra: Partial<SupplierEightDDeadlinePending> = {}): SupplierEightDDeadlinePending => ({
  id: 'request', version: 1, stage: 'ANALYSIS', status: 'QUALITY_PENDING', originalDueAt: '2026-10-28T08:00:00Z',
  requestedDueAt: '2026-10-30T08:00:00Z', updatedAt: '2026-10-28T08:00:00Z', pendingUserId: 'sqe', ...extra,
});

describe('supplier 8D reminder policy', () => {
  it('moves handling from analysis to submission only after analysis completion', () => {
    expect(supplierHandlingStage(context())).toBe('ANALYSIS');
    expect(supplierHandlingStage(context({ analysisCompletedAt: '2026-10-28T09:00:00Z' }))).toBe('SUBMISSION');
  });
  it.each([{ handling: false }, { submittedRevisionId: 'revision' }, { closedAt: now.toISOString() },
    { releasedToSupplierAt: null }, { supplierOrganizationId: null }])('does not create external work in state %j', extra => {
    expect(supplierHandlingStage(context(extra))).toBeNull();
    expect(supplierReminderPlans(context(extra), null, [], now)).toEqual([]);
  });
  it('keeps the legacy INTERNAL responder independent of external release', () => {
    expect(supplierHandlingStage(context({ replyMode: 'INTERNAL', releasedToSupplierAt: null, supplierOrganizationId: null }))).toBe('ANALYSIS');
  });
  it.each([null, 0, -1, 1.5, 8761, NaN, Infinity])('disables invalid or unconfigured cadence %s', hours => {
    expect(supplierReminderSlot(context().analysisDueAt, hours, now)).toBeNull();
    expect(supplierReminderPlans(context({ reminderEveryHours: hours }), null, [], now)).toEqual([]);
  });
  it('uses hourly slots from the real due time, including both configuration bounds', () => {
    expect(supplierReminderSlot('2026-10-28T10:00:00Z', 1, now)).toBe(0);
    expect(supplierReminderSlot('2026-10-28T10:00:01Z', 1, now)).toBeNull();
    expect(supplierReminderSlot('2026-10-28T08:00:00Z', 1, now)).toBe(2);
    expect(supplierReminderSlot('2026-10-28T08:00:00Z', 8760, now)).toBe(0);
    expect(supplierReminderSlot(null, 1, now)).toBeNull();
    expect(supplierReminderSlot('invalid', 1, now)).toBeNull();
    expect(supplierReminderSlot(now.toISOString(), 1, new Date(NaN))).toBeNull();
  });
  it('never reminds passed, waiting, cancelled or old closure sides', () => {
    const c = context({ handling: false, submittedRevisionId: 'revision' });
    const plans = supplierReminderPlans(c, closure, [], now);
    expect(plans.map(p => [p.kind, p.userId, p.duty])).toEqual([['CLOSURE_REMINDER', 'manager', 'SECTION_MANAGER']]);
    expect(supplierReminderPlans(c, null, [], now)).toEqual([]);
    expect(supplierReminderPlans(context({ closedAt: now.toISOString() }), closure, [], now)).toEqual([]);
  });
  it('retains two real management duties for one person without skipping either', () => {
    const plans = supplierReminderPlans(context({ handling: false, submittedRevisionId: 'revision' }), {
      ...closure, duties: [{ duty: 'SECTION_MANAGER', userId: 'same', status: 'PENDING' }, { duty: 'MINISTER', userId: 'same', status: 'PENDING' }],
    }, [], now);
    expect(plans.map(p => p.duty)).toEqual(['SECTION_MANAGER', 'MINISTER']);
    expect(new Set(plans.map(p => p.fingerprint)).size).toBe(2);
  });
  it('uses the supplier extension port current duty, including a second same-person manager step', () => {
    const a = supplierReminderPlans(context(), null, [extension()], now).find(p => p.kind === 'EXTENSION_PENDING')!;
    const b = supplierReminderPlans(context(), null, [extension({ status: 'MANAGER_PENDING', version: 2 })], now).find(p => p.kind === 'EXTENSION_PENDING')!;
    expect([a.userId, a.duty, b.userId, b.duty]).toEqual(['sqe', 'SQE', 'sqe', 'MANAGER']);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
  it('does not remind an extension on a completed analysis/submission/closure side', () => {
    expect(supplierReminderPlans(context({ analysisCompletedAt: now.toISOString() }), null, [extension()], now).some(p => p.kind === 'EXTENSION_PENDING')).toBe(false);
    expect(supplierReminderPlans(context({ handling: false, submittedRevisionId: 'revision' }), null,
      [extension({ stage: 'SUBMISSION' })], now)).toEqual([]);
    expect(supplierReminderPlans(context({ closedAt: now.toISOString() }), null, [extension({ stage: 'CLOSURE' })], now)).toEqual([]);
    expect(supplierReminderPlans(context({ handling: false, submittedRevisionId: 'revision' }), null,
      [extension({ stage: 'CLOSURE' })], now)).toEqual([]);
  });
  it('deduplicates exact handling recipients and fixes notification source and payload', () => {
    const [plan] = supplierReminderPlans(context({ handlingUserIds: ['supplier-user', 'supplier-user'] }), null, [], now);
    expect(supplierReminderPlans(context({ handlingUserIds: ['supplier-user', 'supplier-user'] }), null, [], now)).toHaveLength(1);
    const event = supplierReminderEvent(context(), plan);
    expect(event).toEqual({ eventKey: `supplier-eight-d-reminder:${context().supplierProblemId}:${plan.fingerprint}:${plan.slot}`,
      eventType: 'SUPPLIER_EIGHT_D_REMINDER_DUE', aggregateType: 'SupplierEightDReminder', aggregateId: context().supplierProblemId,
      payload: { schemaVersion: 1, organizationId: context().organizationId, supplierProblemId: context().supplierProblemId,
        problemId: context().problemId, fingerprint: plan.fingerprint, slot: plan.slot } });
    expect(supplierReminderEvent(context(), plan)).toEqual(event);
    const [changed] = supplierReminderPlans(context({ instanceVersion: 2 }), null, [], now);
    expect(changed.fingerprint).not.toBe(plan.fingerprint);
  });
  it('accepts only the exact server-owned supplier reminder envelope', () => {
    const c = context(), [plan] = supplierReminderPlans(c, null, [], now), event = supplierReminderEvent(c, plan);
    expect(supplierReminderPayload(event)).toEqual(event.payload);
  });
  it.each([
    { eventType: 'WORKFLOW_DEADLINE_EXTENSION_CHANGED' }, { aggregateType: 'ProcessEightDReminder' }, { aggregateId: 'other' }, { eventKey: 'forged' },
    { payload: null }, { payload: [] }, { payload: { schemaVersion: 2 } },
  ])('rejects forged event source %j', extra => {
    const c = context(), [plan] = supplierReminderPlans(c, null, [], now);
    expect(() => supplierReminderPayload({ ...supplierReminderEvent(c, plan), ...extra })).toThrow('SUPPLIER_EIGHT_D_REMINDER_EVENT_INVALID');
  });
  it.each([{ schemaVersion: '1' }, { organizationId: 'bad' }, { supplierProblemId: 'bad' }, { problemId: 'bad' },
    { fingerprint: '0'.repeat(63) }, { slot: -1 }, { slot: 0.5 }, { slot: '0' }, { slot: Number.MAX_SAFE_INTEGER + 1 }])('rejects malformed event payload %j', extra => {
    const c = context(), [plan] = supplierReminderPlans(c, null, [], now), event = supplierReminderEvent(c, plan);
    expect(() => supplierReminderPayload({ ...event, payload: { ...event.payload, ...extra } })).toThrow('SUPPLIER_EIGHT_D_REMINDER_EVENT_INVALID');
  });
  it('projects current eligible work on release even with null cadence and future/no due dates', () => {
    const c = context({ reminderEveryHours: null, analysisDueAt: null });
    expect(supplierReminderPlans(c, null, [], now)).toEqual([]);
    expect(supplierProjectionPlans(c, null, [])).toMatchObject([{ kind: 'HANDLING_REMINDER', userId: 'supplier-user', slot: 0 }]);
    expect(supplierProjectionPlans({ ...c, releasedToSupplierAt: null }, null, [])).toEqual([]);
    expect(supplierProjectionPlans({ ...c, closedAt: now.toISOString() }, null, [])).toEqual([]);
  });
  it('projects only the actual current side at structural SQE/manager transitions without cadence', () => {
    const c = context({ reminderEveryHours: null, handling: false, submittedRevisionId: 'revision' });
    expect(supplierProjectionPlans(c, closure, [])).toMatchObject([{ userId: 'manager', duty: 'SECTION_MANAGER' }]);
    expect(supplierProjectionPlans(context({ reminderEveryHours: null }), null, [extension()]).map(p => p.userId)).toEqual(['supplier-user', 'sqe']);
  });
  const change = () => ({ eventType: 'SUPPLIER_EIGHT_D_CHANGED', aggregateType: 'SupplierEightD', aggregateId: context().supplierProblemId,
    eventKey: `supplier-eight-d:${context().supplierProblemId}:RELEASE:${'a'.repeat(64)}`,
    payload: { schemaVersion: 1, organizationId: context().organizationId, supplierProblemId: context().supplierProblemId, problemId: context().problemId,
      action: 'RELEASE', rowVersion: 1, contentVersion: 2, instanceVersion: 3 } });
  it('accepts the actual disclosure release source and bounded core source versions', () => {
    expect(supplierChangePayload(change())).toEqual(change().payload);
    const core = change();
    expect(supplierChangePayload({ ...core, payload: { ...core.payload, schemaVersion: undefined } })).toMatchObject({ action: 'RELEASE' });
  });
  it.each([{ eventKey: 'forged' }, { aggregateType: 'SupplierEightDReminder' }, { payload: {} }])('rejects forged structure event %j', extra => {
    expect(() => supplierChangePayload({ ...change(), ...extra })).toThrow('SUPPLIER_EIGHT_D_CHANGE_EVENT_INVALID');
  });
  it('accepts only the dedicated supplier deadline source, not the internal policy source', () => {
    const requestId = '00000000-0000-4000-8000-000000000004';
    const event = { eventType: 'SUPPLIER_EIGHT_D_DEADLINE_CHANGED', aggregateType: 'SupplierEightDDeadline', aggregateId: requestId,
      eventKey: `supplier-eight-d-deadline:${requestId}:v2`, payload: { schemaVersion: 1, organizationId: context().organizationId,
        supplierProblemId: context().supplierProblemId, requestId, version: 2, stage: 'ANALYSIS', status: 'MANAGER_PENDING' } };
    expect(supplierDeadlineChangePayload(event)).toEqual(event.payload);
    expect(() => supplierDeadlineChangePayload({ ...event, eventType: 'WORKFLOW_DEADLINE_EXTENSION_CHANGED' })).toThrow('SUPPLIER_EIGHT_D_DEADLINE_EVENT_INVALID');
  });
});
