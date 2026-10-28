import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import type { SupplierEightDTaskContext, SupplierEightDClosurePending, SupplierEightDDeadlinePending, SupplierEightDReminderPlan, SupplierEightDTaskStage } from './supplier-eight-d-task.types.js';

const available = (c: SupplierEightDTaskContext) => !c.closedAt
  && (c.replyMode === 'INTERNAL' || !!c.supplierOrganizationId && !!c.releasedToSupplierAt);

export function supplierHandlingStage(c: SupplierEightDTaskContext): SupplierEightDTaskStage | null {
  if (!available(c) || !c.handling || c.submittedRevisionId) return null;
  return c.analysisCompletedAt ? 'SUBMISSION' : 'ANALYSIS';
}

export function supplierReminderSlot(dueAt: string | null, hours: number | null, now: Date): number | null {
  if (!dueAt || hours === null || !Number.isSafeInteger(hours) || hours < 1 || hours > 8760 || !Number.isFinite(now.getTime())) return null;
  const due = new Date(dueAt).getTime();
  return !Number.isFinite(due) || now.getTime() < due ? null : Math.floor((now.getTime() - due) / (hours * 3600000));
}

export function supplierReminderPlans(c: SupplierEightDTaskContext, closure: SupplierEightDClosurePending | null,
  extensions: SupplierEightDDeadlinePending[], now: Date): SupplierEightDReminderPlan[] {
  return notificationPlans(c, closure, extensions, now);
}

export function supplierProjectionPlans(c: SupplierEightDTaskContext, closure: SupplierEightDClosurePending | null,
  extensions: SupplierEightDDeadlinePending[]): SupplierEightDReminderPlan[] {
  return notificationPlans(c, closure, extensions, null);
}

function notificationPlans(c: SupplierEightDTaskContext, closure: SupplierEightDClosurePending | null,
  extensions: SupplierEightDDeadlinePending[], now: Date | null): SupplierEightDReminderPlan[] {
  if (!available(c)) return [];
  const plans: SupplierEightDReminderPlan[] = [];
  const stamp = [c.organizationId, c.supplierProblemId, c.problemId, c.instanceId, c.workflowVersionId, c.rowVersion,
    c.contentVersion, c.instanceVersion, c.replyMode, c.supplierOrganizationId, c.releasedToSupplierAt, now ? c.reminderEveryHours : null];
  const add = (facts: Omit<SupplierEightDReminderPlan, 'fingerprint' | 'slot' | 'projection'>, from: string | null) => {
    const slot = now ? supplierReminderSlot(from, c.reminderEveryHours, now) : 0;
    if (slot === null) return;
    const projection = now ? 'PERIODIC' : 'STATE_CHANGE';
    const fingerprint = createHash('sha256').update(JSON.stringify([stamp, facts, from, projection])).digest('hex');
    plans.push({ ...facts, projection, fingerprint, slot });
  };
  const base = { duty: null, roundId: null, roundVersion: null, requestId: null, requestVersion: null };
  const stage = supplierHandlingStage(c);
  if (stage) {
    const dueAt = stage === 'ANALYSIS' ? c.analysisDueAt : c.submissionDueAt;
    for (const userId of new Set(c.handlingUserIds)) add({ ...base, kind: 'HANDLING_REMINDER', userId, stage, dueAt }, dueAt);
  } else if (c.submittedRevisionId && !c.handling && closure) {
    for (const duty of closure.duties.filter(d => d.status === 'PENDING')) add({ ...base, kind: 'CLOSURE_REMINDER', userId: duty.userId,
      stage: 'CLOSURE', dueAt: c.closureDueAt, duty: duty.duty, roundId: closure.roundId, roundVersion: closure.roundVersion }, c.closureDueAt);
  }
  for (const request of extensions) {
    if (!c.handling || c.submittedRevisionId || request.stage === 'ANALYSIS' && c.analysisCompletedAt) continue;
    add({ ...base, kind: 'EXTENSION_PENDING', userId: request.pendingUserId, stage: request.stage, dueAt: request.originalDueAt,
      duty: request.status === 'QUALITY_PENDING' ? 'SQE' : 'MANAGER', requestId: request.id, requestVersion: request.version }, request.updatedAt);
  }
  return plans;
}

export function supplierReminderEvent(c: SupplierEightDTaskContext, plan: SupplierEightDReminderPlan) {
  return { eventKey: `supplier-eight-d-reminder:${c.supplierProblemId}:${plan.fingerprint}:${plan.slot}`,
    eventType: 'SUPPLIER_EIGHT_D_REMINDER_DUE', aggregateType: 'SupplierEightDReminder', aggregateId: c.supplierProblemId,
    payload: { schemaVersion: 1, organizationId: c.organizationId, supplierProblemId: c.supplierProblemId,
      problemId: c.problemId, fingerprint: plan.fingerprint, slot: plan.slot } };
}

export function supplierReminderPayload(event: unknown): ReturnType<typeof supplierReminderEvent>['payload'] {
  const e = (event && typeof event === 'object' ? event : {}) as Record<string, unknown>;
  const p = (e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload) ? e.payload : {}) as Record<string, unknown>;
  if (e.eventType !== 'SUPPLIER_EIGHT_D_REMINDER_DUE' || e.aggregateType !== 'SupplierEightDReminder' || p.schemaVersion !== 1
    || ['organizationId', 'supplierProblemId', 'problemId'].some(key => typeof p[key] !== 'string' || !isUUID(p[key] as string))
    || typeof p.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(p.fingerprint)
    || !Number.isSafeInteger(p.slot) || Number(p.slot) < 0 || e.aggregateId !== p.supplierProblemId
    || e.eventKey !== `supplier-eight-d-reminder:${p.supplierProblemId}:${p.fingerprint}:${p.slot}`) throw new Error('SUPPLIER_EIGHT_D_REMINDER_EVENT_INVALID');
  return p as ReturnType<typeof supplierReminderEvent>['payload'];
}

type ChangePayload = { schemaVersion?: number; organizationId: string; supplierProblemId: string; problemId: string;
  action: string; rowVersion: number; contentVersion: number; instanceVersion?: number };
type DeadlineChangePayload = { schemaVersion: number; organizationId: string; supplierProblemId: string; requestId: string;
  version: number; stage: string; status: string };
const object = (raw: unknown): Record<string, unknown> => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
const version = (raw: unknown) => Number.isSafeInteger(raw) && Number(raw) >= 1 && Number(raw) <= 2147483647;

export function supplierChangePayload(event: unknown): ChangePayload {
  const e = object(event), p = object(e.payload);
  if (e.eventType !== 'SUPPLIER_EIGHT_D_CHANGED' || e.aggregateType !== 'SupplierEightD' || p.schemaVersion !== undefined && p.schemaVersion !== 1
    || ['organizationId', 'supplierProblemId', 'problemId'].some(key => typeof p[key] !== 'string' || !isUUID(p[key] as string))
    || !['ISSUE', 'SAVE', 'ANALYSIS_COMPLETE', 'SUBMIT', 'DEADLINES', 'DEADLINE_EXTENDED', 'CLOSED', 'RELEASE', 'RETURN'].includes(String(p.action))
    || !version(p.rowVersion) || !version(p.contentVersion) || p.instanceVersion !== undefined && !version(p.instanceVersion)
    || e.aggregateId !== p.supplierProblemId || typeof e.eventKey !== 'string'
    || e.eventKey !== `supplier-eight-d:${p.supplierProblemId}:${p.action}:${e.eventKey.slice(-64)}`
    || !/^[0-9a-f]{64}$/.test(e.eventKey.slice(-64))) throw new Error('SUPPLIER_EIGHT_D_CHANGE_EVENT_INVALID');
  return p as ChangePayload;
}

export function supplierDeadlineChangePayload(event: unknown): DeadlineChangePayload {
  const e = object(event), p = object(e.payload);
  if (e.eventType !== 'SUPPLIER_EIGHT_D_DEADLINE_CHANGED' || e.aggregateType !== 'SupplierEightDDeadline' || p.schemaVersion !== 1
    || ['organizationId', 'supplierProblemId', 'requestId'].some(key => typeof p[key] !== 'string' || !isUUID(p[key] as string))
    || !version(p.version) || !['ANALYSIS', 'SUBMISSION', 'CLOSURE'].includes(String(p.stage))
    || !['QUALITY_PENDING', 'MANAGER_PENDING', 'APPROVED', 'RETURNED', 'CANCELLED'].includes(String(p.status))
    || e.aggregateId !== p.requestId || e.eventKey !== `supplier-eight-d-deadline:${p.requestId}:v${p.version}`) throw new Error('SUPPLIER_EIGHT_D_DEADLINE_EVENT_INVALID');
  return p as DeadlineChangePayload;
}
