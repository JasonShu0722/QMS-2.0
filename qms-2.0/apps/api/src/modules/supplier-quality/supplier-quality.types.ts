import type { AuthorizedSessionUser } from '../authorization/authorization.service.js';
import type { ResponseForm } from '../problem-index/problem.types.js';

export const SUPPLIER_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const MATERIAL_CATEGORIES = ['STRUCTURE', 'ELECTRONIC'] as const;
export const SUPPLIER_REPLY_MODES = ['INTERNAL', 'SUPPLIER'] as const;

export interface SupplierProblemFacts {
  supplierOrganizationId: string;
  title: string;
  materialCode: string;
  materialCategory?: (typeof MATERIAL_CATEGORIES)[number];
  defectDescription: string;
  defectQuantity: number;
  severity: (typeof SUPPLIER_SEVERITIES)[number];
  responseForm: ResponseForm;
  replyMode: (typeof SUPPLIER_REPLY_MODES)[number];
  internalResponderId?: string;
}

export type SupplierActor = AuthorizedSessionUser;

export interface SupplierProblemResource {
  id: string;
  ownerOrganizationId: string;
  supplierOrganizationId: string;
  replyMode: SupplierProblemFacts['replyMode'];
  internalResponderId: string | null;
  releasedToSupplier: boolean;
  contentVersion: number;
}

export interface SupplierVerification {
  problemId: string;
  verifierId: string;
  contentVersion: number;
  accepted: boolean;
}

export interface SupplierEvidence {
  id: string;
  organizationId: string;
  resourceType: string | null;
  resourceId: string | null;
  status: string;
}

export interface SupplierResponseContent {
  problemDescription?: string;
  containmentAction?: string;
  interimAction?: string;
  rootCause?: string;
  correctiveAction?: string;
  preventiveAction?: string;
  verificationResult?: string;
  completionTime?: string;
}

export type SupplierRuleErrorCode = 'SUPPLIER_FACTS_INVALID' | 'SUPPLIER_RESPONSE_INVALID' | 'SUPPLIER_RESOURCE_DENIED'
  | 'SUPPLIER_REPLY_DENIED' | 'SUPPLIER_CLOSURE_DENIED' | 'SUPPLIER_EVIDENCE_INVALID';

export class SupplierRuleError extends Error {
  constructor(readonly code: SupplierRuleErrorCode, readonly fields: Record<string, string> = {}) {
    super(code);
    this.name = 'SupplierRuleError';
  }
}
