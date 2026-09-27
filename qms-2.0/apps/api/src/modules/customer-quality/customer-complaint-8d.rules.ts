export type EightDApprovalLevel = 'L1' | 'L2' | 'L3';

export type CustomerComplaintEightDContent = {
  what: string;
  why: string;
  where: string;
  when: string;
  who: string;
  how: string;
  howMuch: string;
  containment: string;
  rootCause: string;
  verification: string;
  preventiveAction: string;
  horizontalDeployment: string;
  lessonsLearned: string;
  verificationEvidenceFileIds: string[];
  archiveChecklist: string[];
};

const textFields = ['what', 'why', 'where', 'when', 'who', 'how', 'howMuch', 'containment', 'rootCause', 'verification', 'preventiveAction', 'horizontalDeployment', 'lessonsLearned'] as const;
const checklistValues = ['SOURCE_CONFIRMED', 'CONTAINMENT_VERIFIED', 'ROOT_CAUSE_VERIFIED', 'PREVENTION_DEPLOYED', 'HORIZONTAL_DEPLOYMENT_RECORDED', 'EVIDENCE_COMPLETE'] as const;

export function validateEightDContent(input: unknown, mode: 'DRAFT' | 'SUBMIT'): CustomerComplaintEightDContent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('CUSTOMER_8D_INPUT_INVALID');
  const raw = input as Record<string, unknown>;
  const allowed = new Set<string>([...textFields, 'verificationEvidenceFileIds', 'archiveChecklist']);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error('CUSTOMER_8D_INPUT_INVALID');
  const result = {} as CustomerComplaintEightDContent;
  for (const key of textFields) {
    const value = raw[key];
    if (typeof value !== 'string' || value.trim().length > 10000) throw new Error('CUSTOMER_8D_INPUT_INVALID');
    result[key] = value.trim();
  }
  if (!Array.isArray(raw.verificationEvidenceFileIds) || raw.verificationEvidenceFileIds.some((id) => typeof id !== 'string') || new Set(raw.verificationEvidenceFileIds).size !== raw.verificationEvidenceFileIds.length) throw new Error('CUSTOMER_8D_INPUT_INVALID');
  result.verificationEvidenceFileIds = raw.verificationEvidenceFileIds as string[];
  if (!Array.isArray(raw.archiveChecklist) || raw.archiveChecklist.some((item) => !checklistValues.includes(item as never)) || new Set(raw.archiveChecklist).size !== raw.archiveChecklist.length) throw new Error('CUSTOMER_8D_INPUT_INVALID');
  result.archiveChecklist = raw.archiveChecklist as string[];
  if (mode === 'SUBMIT' && (textFields.some((key) => !result[key]) || result.verificationEvidenceFileIds.length === 0 || result.archiveChecklist.length !== checklistValues.length || !result.archiveChecklist.every((item) => checklistValues.includes(item as never)))) throw new Error('CUSTOMER_8D_SUBMISSION_INCOMPLETE');
  return result;
}
