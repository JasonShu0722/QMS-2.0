import type { WorkflowDeadlineContext, WorkflowDeadlinePolicy, WorkflowDeadlineStage, WorkflowDeadlineStatus } from './workflow-deadline-extension.types.js';

export function deadlineDueAt(context: WorkflowDeadlineContext, stage: WorkflowDeadlineStage): string | null {
  if (stage === 'ANALYSIS') return context.analysisDueAt;
  if (stage === 'SUBMISSION') return context.submissionDueAt;
  if (stage === 'CLOSURE') return context.closureDueAt;
  throw new Error('DEADLINE_STAGE_INVALID');
}
export function deadlineStageOpen(context: WorkflowDeadlineContext, stage: WorkflowDeadlineStage): boolean {
  if (context.closedAt) return false;
  if (stage === 'ANALYSIS') return !context.analysisCompletedAt && !context.submittedAt;
  if (stage === 'SUBMISSION') return !context.submittedAt;
  if (stage === 'CLOSURE') return true;
  throw new Error('DEADLINE_STAGE_INVALID');
}
export function initialDeadlineStatus(applicant: string, leader: string): WorkflowDeadlineStatus {
  return applicant === leader ? 'QUALITY_PENDING' : 'LEADER_PENDING';
}
export function nextDeadlineStatus(status: WorkflowDeadlineStatus, decision: 'APPROVE' | 'RETURN'): WorkflowDeadlineStatus {
  if (!['LEADER_PENDING', 'QUALITY_PENDING'].includes(status) || !['APPROVE', 'RETURN'].includes(decision)) throw new Error('DEADLINE_ACTION_INVALID');
  return decision === 'RETURN' ? 'RETURNED' : status === 'LEADER_PENDING' ? 'QUALITY_PENDING' : 'APPROVED';
}
export function sameDeadlineSources(before: WorkflowDeadlineContext, after: WorkflowDeadlineContext, stage: WorkflowDeadlineStage): boolean {
  return (['organizationId', 'problemId', 'instanceId', 'workflowVersionId', 'ownerNodeId', 'ownerUserId', 'professionalUserId', 'responsibleSectionDepartmentId'] as const)
    .every(key => before[key] === after[key]) && deadlineDueAt(before, stage) === deadlineDueAt(after, stage)
    && deadlineStageOpen(after, stage) && before.policy?.schemaVersion === after.policy?.schemaVersion
    && before.policy?.extensionPolicy === after.policy?.extensionPolicy && before.policy?.reminderEveryHours === after.policy?.reminderEveryHours;
}
export function parseDeadlinePolicy(raw: unknown): WorkflowDeadlinePolicy | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (Object.keys(p).some(key => !['schemaVersion', 'extensionPolicy', 'reminderEveryHours'].includes(key)) || p.schemaVersion !== 1
    || p.extensionPolicy !== 'LEADER_THEN_PROFESSIONAL' || (p.reminderEveryHours !== null
      && (!Number.isSafeInteger(p.reminderEveryHours) || Number(p.reminderEveryHours) < 1 || Number(p.reminderEveryHours) > 8760))) return null;
  return { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: p.reminderEveryHours as number | null };
}
