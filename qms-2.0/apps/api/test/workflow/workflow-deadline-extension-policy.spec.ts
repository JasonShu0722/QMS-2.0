import { deadlineDueAt, deadlineStageOpen, initialDeadlineStatus, nextDeadlineStatus, sameDeadlineSources, parseDeadlinePolicy } from '../../src/modules/workflow/workflow-deadline-extension.policy.js';
import type { WorkflowDeadlineContext } from '../../src/modules/workflow/workflow-deadline-extension.types.js';

export const context: WorkflowDeadlineContext = {
  organizationId: 'org', problemId: 'problem', instanceId: 'instance', workflowVersionId: 'version', ownerNodeId: 'node',
  ownerUserId: 'owner', professionalUserId: 'quality', responsibleSectionDepartmentId: 'section',
  analysisDueAt: '2026-10-20T00:00:00.000Z', submissionDueAt: null, closureDueAt: '2026-11-01T00:00:00.000Z',
  analysisCompletedAt: null, submittedAt: null, closedAt: null, rowVersion: 1, contentVersion: 1, instanceVersion: 1,
  policy: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 },
};

describe('bounded internal extension policy', () => {
  it('keeps original deadlines pending all approvals and never invents a missing due date', () => {
    expect(deadlineDueAt(context, 'ANALYSIS')).toBe(context.analysisDueAt);
    expect(deadlineDueAt(context, 'SUBMISSION')).toBeNull();
    expect(nextDeadlineStatus('LEADER_PENDING', 'APPROVE')).toBe('QUALITY_PENDING');
    expect(nextDeadlineStatus('QUALITY_PENDING', 'APPROVE')).toBe('APPROVED');
    expect(context.analysisDueAt).toBe('2026-10-20T00:00:00.000Z');
  });
  it('skips only a real same-person leader, never quality', () => {
    expect(initialDeadlineStatus('owner', 'owner')).toBe('QUALITY_PENDING');
    expect(initialDeadlineStatus('owner', 'leader')).toBe('LEADER_PENDING');
  });
  it('returns either pending side without changing the deadline', () => {
    expect(nextDeadlineStatus('LEADER_PENDING', 'RETURN')).toBe('RETURNED');
    expect(nextDeadlineStatus('QUALITY_PENDING', 'RETURN')).toBe('RETURNED');
    expect(() => nextDeadlineStatus('APPROVED', 'APPROVE')).toThrow();
    expect(() => nextDeadlineStatus('QUALITY_PENDING', 'UNKNOWN' as 'APPROVE')).toThrow();
  });
  it('rejects absent/unknown node policies without supplying default days', () => {
    expect(parseDeadlinePolicy(null)).toBeNull();
    expect(parseDeadlinePolicy({ ...context.policy, extensionPolicy: 'ANY' })).toBeNull();
    expect(parseDeadlinePolicy({ ...context.policy, reminderEveryHours: 0 })).toBeNull();
    expect(parseDeadlinePolicy({ ...context.policy, reminderEveryHours: null })).toEqual({ ...context.policy, reminderEveryHours: null });
  });
  it('does not invalidate an extension for an unrelated body save', () => {
    expect(sameDeadlineSources(context, { ...context, rowVersion: 9, contentVersion: 9 }, 'ANALYSIS')).toBe(true);
    expect(sameDeadlineSources(context, { ...context, ownerUserId: 'replacement' }, 'ANALYSIS')).toBe(false);
    expect(sameDeadlineSources(context, { ...context, analysisDueAt: context.closureDueAt }, 'ANALYSIS')).toBe(false);
    expect(sameDeadlineSources(context, { ...context, workflowVersionId: 'replacement' }, 'ANALYSIS')).toBe(false);
  });
  it('does not treat a complete submission as unhandled owner work', () => {
    expect(deadlineStageOpen(context, 'ANALYSIS')).toBe(true);
    expect(deadlineStageOpen({ ...context, analysisCompletedAt: 'done' }, 'ANALYSIS')).toBe(false);
    expect(deadlineStageOpen({ ...context, submittedAt: 'done' }, 'SUBMISSION')).toBe(false);
    expect(deadlineStageOpen({ ...context, closedAt: 'done' }, 'CLOSURE')).toBe(false);
  });
});
