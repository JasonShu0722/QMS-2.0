import type { WorkflowDeadlineContext, WorkflowDeadlineStage } from '../workflow/workflow-deadline-extension.types.js';

export function handlingReminderStage(c: WorkflowDeadlineContext): WorkflowDeadlineStage | null {
  if (c.closedAt || c.submittedAt) return null;
  return c.analysisCompletedAt ? 'SUBMISSION' : 'ANALYSIS';
}
export function reminderSlot(dueAt: string | null, hours: number | null, now: Date): number | null {
  if (!dueAt || hours === null || !Number.isSafeInteger(hours) || hours < 1 || hours > 8760 || !Number.isFinite(now.getTime())) return null;
  const due = new Date(dueAt).getTime();
  return !Number.isFinite(due) || now.getTime() < due ? null : Math.floor((now.getTime() - due) / (hours * 3600000));
}
