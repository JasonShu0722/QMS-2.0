import type { Prisma, ProblemIndex, WorkflowInstance, WorkflowNode } from '../../generated/prisma/client.js';
import type { AdminActor } from '../../common/security/admin-mutation.service.js';
import type { ProcessEightDDocument } from './process-eight-d-document.js';
import type { WorkflowDeadlineContext } from '../workflow/workflow-deadline-extension.types.js';

export type ProcessEightDActor = AdminActor;
export type ProcessEightDPurpose = 'READ' | 'EDIT' | 'SUBMIT' | 'DECIDE' | 'CANCEL' | 'DEADLINE';
export type ProcessEightDStage = 'ANALYSIS' | 'SUBMISSION' | 'CLOSURE';
export type ProcessEightDSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export interface ProcessEightDReport {
  problemId: string;
  organizationId: string;
  responsibleSectionDepartmentId: string;
  professionalUserId: string;
  document: ProcessEightDDocument;
  version: number;
  contentVersion: number;
  analysisCompletedAt: Date | null;
  analysisDueAt: Date | null;
  submissionDueAt: Date | null;
  closureDueAt: Date | null;
  submittedAt: Date | null;
  closedRevisionId: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface ProcessEightDRecord {
  problem: ProblemIndex;
  instance: WorkflowInstance;
  node: WorkflowNode;
  report: ProcessEightDReport;
  collaboratorUserIds: string[];
}
export type ProcessEightDDeadlineContext = WorkflowDeadlineContext;
export interface ProcessEightDSourceInput { defectId: string; expectedVersion: number }
export interface ProcessEightDSourceConfirmation {
  defectId: string;
  relatedProblemIds: string[];
  recurrence: 'RECURRENCE' | 'NOT_RECURRENCE';
  reason?: string;
}
export interface IssueProcessEightDInput {
  organizationId?: string;
  sources: ProcessEightDSourceInput[];
  severity: ProcessEightDSeverity;
  ownerUserId: string;
  responsibleSectionDepartmentId: string;
  analysisDueAt?: Date;
  closureDueAt?: Date;
  sourceConfirmations?: ProcessEightDSourceConfirmation[];
}
export interface ProcessEightDVersionInput { organizationId?: string; expectedVersion: number }
export interface SaveProcessEightDInput extends ProcessEightDVersionInput { document: ProcessEightDDocument }
export interface ProcessEightDConfirmCancellation { confirmCancelApproval?: boolean; reason?: string }
export interface ProcessEightDRevision {
  id: string;
  problemId: string;
  organizationId: string;
  contentVersion: number;
  snapshot: Prisma.JsonValue;
  recordedAt: Date;
}
