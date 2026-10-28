export type SupplierEightDTaskStage = 'ANALYSIS' | 'SUBMISSION' | 'CLOSURE';
export type SupplierEightDTaskDuty = 'PROFESSIONAL' | 'SECTION_MANAGER' | 'MINISTER' | 'SQE' | 'MANAGER';
export type SupplierEightDNotificationKind = 'HANDLING_REMINDER' | 'CLOSURE_REMINDER' | 'EXTENSION_PENDING';

// The core port returns locked, current facts, not a caller-supplied approval snapshot.
export interface SupplierEightDTaskContext {
  organizationId: string;
  supplierProblemId: string;
  problemId: string;
  reportNumber: string;
  instanceId: string;
  workflowVersionId: string;
  rowVersion: number;
  contentVersion: number;
  instanceVersion: number;
  handling: boolean;
  analysisDueAt: string | null;
  analysisCompletedAt: string | null;
  submissionDueAt: string | null;
  closureDueAt: string | null;
  closedAt: string | null;
  submittedRevisionId: string | null;
  reminderEveryHours: number | null;
  replyMode: 'SUPPLIER' | 'INTERNAL';
  supplierOrganizationId: string | null;
  releasedToSupplierAt: string | null;
  handlingUserIds: string[];
}

export interface SupplierEightDClosurePending {
  roundId: string;
  roundVersion: number;
  duties: Array<{ duty: SupplierEightDTaskDuty; userId: string; status: string }>;
}

export interface SupplierEightDDeadlinePending {
  id: string;
  version: number;
  stage: SupplierEightDTaskStage;
  status: 'QUALITY_PENDING' | 'MANAGER_PENDING';
  originalDueAt: string;
  requestedDueAt: string;
  updatedAt: string;
  pendingUserId: string;
}

export interface SupplierEightDReminderPlan {
  projection: 'PERIODIC' | 'STATE_CHANGE';
  kind: SupplierEightDNotificationKind;
  userId: string;
  stage: SupplierEightDTaskStage;
  dueAt: string | null;
  duty: SupplierEightDTaskDuty | null;
  roundId: string | null;
  roundVersion: number | null;
  requestId: string | null;
  requestVersion: number | null;
  fingerprint: string;
  slot: number;
}
