import type { Prisma } from '../../generated/prisma/client.js';
import type { WorkflowActor } from './workflow-access-policy.js';
import type { WorkflowDeadlineContext, WorkflowDeadlineOperation, WorkflowDeadlineStage } from './workflow-deadline-extension.types.js';
import type { WorkflowClosureDuty, WorkflowClosureParticipant, WorkflowClosurePlan, WorkflowClosurePolicy, WorkflowClosureSeverity } from './workflow-closure-policy.js';
import type { WorkflowAdministrativeInvalidationInput, WorkflowAdministrativeTarget } from './workflow-administrative-invalidation.types.js';
import type { AdministrativeLifecycleImpact } from '../../common/security/administrative-lifecycle.types.js';

export type { WorkflowClosureDuty } from './workflow-closure-policy.js';
export type WorkflowClosureOperation = 'READ' | 'SUBMIT' | 'DECIDE' | 'CANCEL';
export type WorkflowSupplierSubmissionInput = {
  supplierProblemId: string;
  responseRevisionId: string;
  expectedContentVersion: number;
  expectedInstanceVersion: number;
};
export type WorkflowClosureContext = {
  organizationId: string;
  problemId: string;
  instanceId: string;
  workflowVersionId: string;
  currentNodeId: string;
  instanceVersion: number;
  contentVersion: number;
  content: Prisma.InputJsonValue;
  policy: WorkflowClosurePolicy;
  severity: WorkflowClosureSeverity;
  responsibleSectionDepartmentId: string;
  ownerUserId: string;
  professionalUserId: string;
};

// Server-owned implementations enforce domain scope and lock problem -> instance -> domain content.
export interface WorkflowClosureAdapter {
  readonly domainCode: string;
  lockAndRead(tx: Prisma.TransactionClient, actor: WorkflowActor, problemId: string, operation: WorkflowClosureOperation): Promise<WorkflowClosureContext>;
  lockSupplierSubmission?(tx: Prisma.TransactionClient, actor: WorkflowActor, problemId: string, input: WorkflowSupplierSubmissionInput): Promise<WorkflowClosureContext>;
  complete(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor: WorkflowActor): Promise<void>;
  returnForChanges(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor: WorkflowActor): Promise<void>;
  // Session-independent READ scope: also reject stale domain content/person/section facts in context.
  canNotifyRecipient?(tx: Prisma.TransactionClient, context: WorkflowClosureContext, userId: string): Promise<boolean>;
  deadlineContext?(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor: WorkflowActor, operation: WorkflowDeadlineOperation): Promise<WorkflowDeadlineContext>;
  applyDeadlineExtension?(tx: Prisma.TransactionClient, context: WorkflowClosureContext, stage: WorkflowDeadlineStage, dueAt: Date): Promise<void>;
  // Trusted deletion transaction; return the number of cancelled domain-owned requests, not workflow rounds.
  administrativeInvalidation?(tx: Prisma.TransactionClient, input: WorkflowAdministrativeInvalidationInput): Promise<number>;
  // Read-only discovery for domain-owned pending requests not stored in workflow tables.
  administrativeInvalidationTargets?(tx: Prisma.TransactionClient, impact: AdministrativeLifecycleImpact): Promise<WorkflowAdministrativeTarget[]>;
}

export type WorkflowClosureStartInput = { expectedContentVersion: number; expectedInstanceVersion: number };
export type WorkflowClosureDecideInput = {
  expectedRoundVersion: number;
  duties: WorkflowClosureDuty[];
  decision: 'APPROVE' | 'RETURN';
  comment: string;
};
export type WorkflowClosureCancelInput = { expectedRoundVersion: number; reason: string };
export type WorkflowClosureRoundStatus = 'PENDING' | 'APPROVED' | 'RETURNED' | 'CANCELLED';
export type WorkflowClosureDutyStatus = 'PENDING' | 'WAITING' | 'APPROVED' | 'SKIPPED_SAME_PERSON' | 'CANCELLED';
export type WorkflowClosureDutyRecord = {
  id: string;
  organizationId: string;
  roundId: string;
  duty: WorkflowClosureDuty;
  status: WorkflowClosureDutyStatus;
  userId: string;
  participant: WorkflowClosureParticipant;
  decidedBy: string | null;
  comment: string | null;
  decidedAt: string | null;
  version: number;
};
export type WorkflowClosureRound = {
  id: string;
  organizationId: string;
  problemId: string;
  instanceId: string;
  workflowVersionId: string;
  nodeId: string;
  contentVersion: number;
  contentSnapshot: Prisma.JsonValue;
  context: WorkflowClosureContext;
  roundNumber: number;
  status: WorkflowClosureRoundStatus;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  duties: WorkflowClosureDutyRecord[];
};
export type WorkflowClosureSnapshot = {
  context: WorkflowClosureContext;
  plan: WorkflowClosurePlan;
  current: WorkflowClosureRound | null;
  sourcesCurrent: boolean;
};

export type WorkflowClosureDutyProjection = {
  organizationId: string;
  problemId: string;
  roundId: string;
  roundVersion: number;
  roundNumber: number;
  duty: WorkflowClosureDuty;
  participant: WorkflowClosureParticipant;
  samePersonDuties: WorkflowClosureDuty[];
};
