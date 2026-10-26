import { handlingReminderStage, reminderSlot } from '../../src/modules/process-quality/process-eight-d-reminder.policy.js';
import type { WorkflowDeadlineContext } from '../../src/modules/workflow/workflow-deadline-extension.types.js';

const c: WorkflowDeadlineContext = {
  organizationId: 'org', problemId: 'p', instanceId: 'i', workflowVersionId: 'v', ownerNodeId: 'n', ownerUserId: 'o', professionalUserId: 'q', responsibleSectionDepartmentId: 's',
  analysisDueAt: '2026-10-20T00:00:00.000Z', submissionDueAt: null, closureDueAt: '2026-11-01T00:00:00.000Z', analysisCompletedAt: null, submittedAt: null, closedAt: null,
  rowVersion: 1, contentVersion: 1, instanceVersion: 1, policy: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 },
};
describe('current-stage reminder policy', () => {
  it('uses only the current stage, not the expired analysis after completion', () => {
    expect(handlingReminderStage(c)).toBe('ANALYSIS');
    expect(handlingReminderStage({ ...c, analysisCompletedAt: 'done' })).toBe('SUBMISSION');
    expect(handlingReminderStage({ ...c, submittedAt: 'done' })).toBeNull();
    expect(handlingReminderStage({ ...c, closedAt: 'done' })).toBeNull();
  });
  it('does not invent overdue or reminder cadence', () => {
    expect(reminderSlot(null, 24, new Date('2026-10-25'))).toBeNull();
    expect(reminderSlot(c.analysisDueAt, null, new Date('2026-10-25'))).toBeNull();
    expect(reminderSlot(c.analysisDueAt, 0, new Date('2026-10-25'))).toBeNull();
    expect(reminderSlot(c.closureDueAt, 24, new Date('2026-10-25'))).toBeNull();
  });
  it('produces one deterministic slot per configured interval with no escalation', () => {
    expect(reminderSlot(c.analysisDueAt, 24, new Date('2026-10-20T01:00Z'))).toBe(0);
    expect(reminderSlot(c.analysisDueAt, 24, new Date('2026-10-20T23:59Z'))).toBe(0);
    expect(reminderSlot(c.analysisDueAt, 24, new Date('2026-10-21T00:00Z'))).toBe(1);
    expect(reminderSlot('invalid', 24, new Date())).toBeNull();
  });
});
