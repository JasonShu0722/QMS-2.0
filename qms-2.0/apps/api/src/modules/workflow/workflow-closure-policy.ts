export type WorkflowClosurePolicy = 'INTERNAL' | 'SUPPLIER';
export type WorkflowClosureSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type WorkflowClosureDuty = 'PROFESSIONAL' | 'SECTION_MANAGER' | 'MINISTER';

export type WorkflowClosureParticipant = {
  userId: string;
  assignmentId: string | null;
  positionId: string | null;
  departmentId: string | null;
  bindingId: string | null;
  scopeId: string | null;
  bindingVersion: number | null;
  scopeVersion: number | null;
};

export type WorkflowClosureInput = {
  policy: WorkflowClosurePolicy;
  severity: WorkflowClosureSeverity;
  ownerUserId?: string;
  professional: WorkflowClosureParticipant | null;
  sectionManager: WorkflowClosureParticipant | null;
  minister: WorkflowClosureParticipant | null;
};

export type WorkflowClosurePlan = {
  executionMode: 'PARALLEL' | 'PROFESSIONAL_THEN_MANAGEMENT';
  duties: Array<{
    duty: WorkflowClosureDuty;
    status: 'PENDING' | 'WAITING' | 'SKIPPED_SAME_PERSON';
    participant: WorkflowClosureParticipant | null;
  }>;
  samePersonGroups: Array<{ userId: string; duties: WorkflowClosureDuty[] }>;
};

export function planWorkflowClosure(input: WorkflowClosureInput): WorkflowClosurePlan {
  if (input.policy !== 'INTERNAL' && input.policy !== 'SUPPLIER') {
    throw new Error('Invalid workflow closure policy');
  }
  if (input.severity !== 'LOW' && input.severity !== 'MEDIUM'
    && input.severity !== 'HIGH' && input.severity !== 'CRITICAL') {
    throw new Error('Invalid workflow closure severity');
  }

  const { policy, severity, ownerUserId, professional, sectionManager, minister } = input;
  const highRisk = severity === 'HIGH' || severity === 'CRITICAL';
  const duties: WorkflowClosurePlan['duties'] = [
    { duty: 'PROFESSIONAL', status: 'PENDING', participant: professional },
  ];

  if (policy === 'INTERNAL') {
    if (highRisk) {
      duties.push({ duty: 'MINISTER', status: 'PENDING', participant: minister });
    } else {
      duties.push({
        duty: 'SECTION_MANAGER',
        status: ownerUserId && sectionManager !== null && sectionManager.userId === ownerUserId
          ? 'SKIPPED_SAME_PERSON' : 'PENDING',
        participant: sectionManager,
      });
    }
    return { executionMode: 'PARALLEL', duties, samePersonGroups: [] };
  }

  duties.push({ duty: 'SECTION_MANAGER', status: 'WAITING', participant: sectionManager });
  if (highRisk) {
    duties.push({ duty: 'MINISTER', status: 'WAITING', participant: minister });
  }
  const samePersonGroups: WorkflowClosurePlan['samePersonGroups'] = [];
  if (highRisk && sectionManager?.userId && minister?.userId === sectionManager.userId) {
    samePersonGroups.push({ userId: sectionManager.userId, duties: ['SECTION_MANAGER', 'MINISTER'] });
  }
  return { executionMode: 'PROFESSIONAL_THEN_MANAGEMENT', duties, samePersonGroups };
}
