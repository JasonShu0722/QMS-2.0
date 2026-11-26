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
  processManagement?: { participant: WorkflowClosureParticipant | null; invalidScope: boolean; unavailableReason?: string };
};

export type WorkflowClosurePlan = {
  executionMode: 'PARALLEL' | 'PROFESSIONAL_THEN_MANAGEMENT';
  duties: Array<{
    duty: WorkflowClosureDuty;
    status: 'PENDING' | 'WAITING' | 'SKIPPED_SAME_PERSON';
    participant: WorkflowClosureParticipant | null;
  }>;
  samePersonGroups: Array<{ userId: string; duties: WorkflowClosureDuty[] }>;
  managementEvent?: { content: string };
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
    if (input.processManagement) {
      const { participant, invalidScope, unavailableReason } = input.processManagement;
      if (participant) duties.push({ duty: highRisk ? 'MINISTER' : 'SECTION_MANAGER', participant,
        status: !highRisk && participant.userId === ownerUserId ? 'SKIPPED_SAME_PERSON' : 'PENDING' });
      const content = !participant ? `${invalidScope ? '原分管任职已失效，' : ''}${unavailableReason ?? '未找到有效管理审核人'}，跳过管理审核`
        : invalidScope ? '原分管任职已失效，改派直属上级主负责人' : undefined;
      return { executionMode: 'PARALLEL', duties, samePersonGroups: [], ...(content ? { managementEvent: { content } } : {}) };
    }
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
