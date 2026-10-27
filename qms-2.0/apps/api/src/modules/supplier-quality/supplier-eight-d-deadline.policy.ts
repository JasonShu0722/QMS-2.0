import { isISO8601 } from 'class-validator';
import { SUPPLIER_SEVERITIES, type SupplierProblemFacts } from './supplier-quality.types.js';

export type SupplierDeadlineApproval = 'QUALITY_PENDING' | 'MANAGER_PENDING' | 'APPROVED' | 'RETURNED' | 'CANCELLED';
export type SupplierDeadlineStage = 'ANALYSIS' | 'SUBMISSION' | 'CLOSURE';
export type SupplierDeadlineDuty = 'SQE' | 'MANAGER';
export type SupplierDeadlineDecisionInput = {
  severity: SupplierProblemFacts['severity'];
  status: SupplierDeadlineApproval;
  decision: 'APPROVE' | 'RETURN';
  duty: SupplierDeadlineDuty;
  actorUserId: string;
  sqeUserId: string;
  managerUserId: string | null;
};

export function initialSupplierDeadlineStatus(severity: SupplierProblemFacts['severity']): SupplierDeadlineApproval {
  if (!SUPPLIER_SEVERITIES.includes(severity)) throw new Error('SUPPLIER_DEADLINE_SEVERITY_INVALID');
  return 'QUALITY_PENDING';
}

export function supplierDeadlineDuty(
  severity: SupplierProblemFacts['severity'], status: SupplierDeadlineApproval,
): SupplierDeadlineDuty | null {
  if (!SUPPLIER_SEVERITIES.includes(severity)) throw new Error('SUPPLIER_DEADLINE_SEVERITY_INVALID');
  if (status === 'QUALITY_PENDING') return 'SQE';
  if (status === 'MANAGER_PENDING' && (severity === 'HIGH' || severity === 'CRITICAL')) return 'MANAGER';
  if (['APPROVED', 'RETURNED', 'CANCELLED'].includes(status)) return null;
  throw new Error('SUPPLIER_DEADLINE_STATE_INVALID');
}

export function nextSupplierDeadlineStatus(input: SupplierDeadlineDecisionInput): SupplierDeadlineApproval {
  const duty = supplierDeadlineDuty(input.severity, input.status);
  if (!duty) throw new Error('SUPPLIER_DEADLINE_STATE_INVALID');
  if (!['APPROVE', 'RETURN'].includes(input.decision)) throw new Error('SUPPLIER_DEADLINE_ACTION_INVALID');
  const expectedUserId = duty === 'SQE' ? input.sqeUserId : input.managerUserId;
  if (input.duty !== duty || typeof expectedUserId !== 'string' || !expectedUserId.trim()
    || input.actorUserId !== expectedUserId) throw new Error('SUPPLIER_DEADLINE_ACTOR_DENIED');
  if (input.decision === 'RETURN') return 'RETURNED';
  // Equal user IDs never collapse the SQE and manager duties into one approval.
  return duty === 'SQE' && (input.severity === 'HIGH' || input.severity === 'CRITICAL') ? 'MANAGER_PENDING' : 'APPROVED';
}

export function assertSupplierDeadlineDates(
  stage: SupplierDeadlineStage, originalDueAt: string, requestedDueAt: string,
): void {
  if (!['ANALYSIS', 'SUBMISSION', 'CLOSURE'].includes(stage)) throw new Error('SUPPLIER_DEADLINE_STAGE_INVALID');
  if ([originalDueAt, requestedDueAt].some(value => typeof value !== 'string'
    || !isISO8601(value, { strict: true, strictSeparator: true }) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) || Date.parse(requestedDueAt) <= Date.parse(originalDueAt)) {
    throw new Error('SUPPLIER_DEADLINE_DATE_INVALID');
  }
}
