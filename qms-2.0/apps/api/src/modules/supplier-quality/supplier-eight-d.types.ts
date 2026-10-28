import type { Prisma, ProblemIndex, SupplierQualityProblem, SupplierResponseDraft, WorkflowInstance, WorkflowNode } from '../../generated/prisma/client.js';
import type { WorkflowActor } from '../workflow/workflow-access-policy.js';
import type { ManagementResponsibilitiesDto } from '../organization/organization-responsibility.dto.js';
import type { SupplierDeadlineStage } from './supplier-eight-d-deadline.policy.js';

export type SupplierEightDActor = WorkflowActor & { scopeOrganizationId?: string };
export interface SupplierEightDControl {
  supplierProblemId: string;
  organizationId: string;
  problemIndexId: string;
  sqeUserId: string;
  sqeAssignmentId: string;
  responsibleSectionDepartmentId: string;
  rowVersion: number;
  analysisDueAt: Date | null;
  analysisCompletedAt: Date | null;
  submissionDueAt: Date | null;
  closureDueAt: Date | null;
  submittedRevisionId: string | null;
  approvedRevisionId: string | null;
  approvedSnapshot: Prisma.JsonValue | null;
  closedAt: Date | null;
}
export interface SupplierEightDRecord {
  supplier: SupplierQualityProblem & { responseDraft: SupplierResponseDraft | null };
  control: SupplierEightDControl;
  problem: ProblemIndex;
  instance: WorkflowInstance;
  node: WorkflowNode;
}

export interface SupplierEightDDisclosureContext {
  organizationId: string;
  supplierProblemId: string;
  problemId: string;
  profileId: string;
  supplierOrganizationId: string | null;
  rowVersion: number;
  contentVersion: number;
  instanceVersion: number;
  releasedToSupplierAt: Date | null;
  publicFacts: {
    title: string;
    materialCode: string;
    materialCategory?: string;
    defectDescription: string;
    defectQuantity: number;
    severity: string;
    reportNumber: string;
  };
}

export interface SupplierEightDDeadlineContext {
  organizationId: string;
  supplierProblemId: string;
  problemId: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  stage: SupplierDeadlineStage;
  originalDueAt: Date;
  rowVersion: number;
  contentVersion: number;
  instanceVersion: number;
  sqeUserId: string;
  sqeAssignmentId: string;
  responsibleSectionDepartmentId: string;
  sqeFingerprint: string;
  management: ManagementResponsibilitiesDto | null;
}
