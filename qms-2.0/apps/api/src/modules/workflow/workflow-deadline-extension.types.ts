import type { WorkflowClosureParticipant } from './workflow-closure-policy.js';

export type WorkflowDeadlineStage = 'ANALYSIS' | 'SUBMISSION' | 'CLOSURE';
export type WorkflowDeadlineOperation = 'READ' | 'REQUEST' | 'DECIDE';
export type WorkflowDeadlinePolicy = {
  schemaVersion: 1;
  extensionPolicy: 'LEADER_THEN_PROFESSIONAL';
  reminderEveryHours: number | null;
};

// Server-owned domain facts; policy is rechecked against the published owner node.
export type WorkflowDeadlineContext = {
  organizationId: string;
  problemId: string;
  instanceId: string;
  workflowVersionId: string;
  ownerNodeId: string;
  ownerUserId: string;
  professionalUserId: string;
  responsibleSectionDepartmentId: string;
  analysisDueAt: string | null;
  submissionDueAt: string | null;
  closureDueAt: string | null;
  analysisCompletedAt: string | null;
  submittedAt: string | null;
  closedAt: string | null;
  rowVersion: number;
  contentVersion: number;
  instanceVersion: number;
  policy: WorkflowDeadlinePolicy | null;
};

export type WorkflowDeadlineStatus = 'LEADER_PENDING' | 'QUALITY_PENDING' | 'APPROVED' | 'RETURNED' | 'CANCELLED';
export type WorkflowDeadlineRequestInput = {
  expectedRowVersion: number;
  expectedInstanceVersion: number;
  stage: WorkflowDeadlineStage;
  requestedDueAt: string;
  reason: string;
};
export type WorkflowDeadlineDecideInput = {
  expectedVersion: number;
  decision: 'APPROVE' | 'RETURN';
  comment?: string;
};
export type WorkflowDeadlineParticipants = {
  leader: WorkflowClosureParticipant;
  professional: WorkflowClosureParticipant;
  leaderSkipped: boolean;
};
export type WorkflowDeadlineExtension = {
  id: string;
  organizationId: string;
  problemId: string;
  workflowVersionId: string;
  stage: WorkflowDeadlineStage;
  originalDueAt: string;
  requestedDueAt: string;
  originallyOverdue: boolean;
  reason: string;
  applicantUserId: string;
  context: WorkflowDeadlineContext;
  participants: WorkflowDeadlineParticipants;
  status: WorkflowDeadlineStatus;
  version: number;
  history: { action: string; userId: string | null; comment: string; at: string }[];
  createdAt: string;
  updatedAt: string;
};
