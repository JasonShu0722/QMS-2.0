import type { Prisma } from '../../generated/prisma/client.js';
import { HttpException } from '@nestjs/common';
import { canonical } from '../workflow/workflow-runtime-policy.js';
import { normalizeProcessEightDDocument, ProcessEightDDocumentError } from '../process-quality/process-eight-d-document.js';
import type { ProcessEightDReportSnapshotDto } from '../process-quality/process-eight-d-report.dto.js';
import type { SupplierEightDActor } from './supplier-eight-d.types.js';
import type { SupplierEightDControlledReportDto, SupplierEightDReportQueryDto } from './supplier-eight-d-report.dto.js';

// Server-only port. No HTTP DTO can supply a snapshot, actor, file group or fingerprint.
export interface SupplierEightDReportRead {
  record: {
    supplier: { id: string; supplierOrganizationId: string | null; releasedToSupplierAt: Date | null };
    control: { organizationId: string; approvedRevisionId: string | null; closedAt: Date | null };
    problem: { id: string };
    node: { config: unknown };
  };
  revision: { id: string } | null;
  snapshot: unknown;
  privateSupplementFileIds: string[];
  versionFingerprint: string;
  inReview?: boolean;
}

export interface SupplierEightDReportCore {
  readReport(tx: Prisma.TransactionClient, actor: SupplierEightDActor, supplierProblemId: string,
    revision: string | null | undefined): Promise<SupplierEightDReportRead>;
}

export function supplierReportFail(code: string, status = 409): never {
  throw new HttpException({ code: `SUPPLIER_EIGHT_D_REPORT_${code}`, message: `SUPPLIER_EIGHT_D_REPORT_${code}` }, status);
}

export function supplierReportObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) supplierReportFail('SNAPSHOT_INVALID');
  return value as Record<string, unknown>;
}

export function supplierEightDReportModel(result: SupplierEightDReportRead, query: SupplierEightDReportQueryDto,
  supplier: boolean): SupplierEightDControlledReportDto {
  const { record, revision } = result;
  if (query.view === 'APPROVED' && !query.revisionId && !revision) supplierReportFail('APPROVED_UNAVAILABLE');
  if (query.revisionId && revision?.id !== query.revisionId) supplierReportFail('VERSION_CONFLICT');
  if (!Array.isArray(result.privateSupplementFileIds) || !result.versionFingerprint) supplierReportFail('SNAPSHOT_INVALID');
  if (supplier && (result.privateSupplementFileIds.length || record.control.closedAt && revision?.id !== record.control.approvedRevisionId && !query.revisionId)) {
    supplierReportFail('PRIVATE_SUPPLEMENT', 403);
  }
  const raw = supplierReportObject(result.snapshot);
  let document;
  try { document = normalizeProcessEightDDocument(raw.document); }
  catch (error) {
    if (error instanceof ProcessEightDDocumentError) supplierReportFail(error.issues.some(issue => issue.path === 'fileIds') ? 'EVIDENCE_LIMIT' : 'SNAPSHOT_INVALID');
    throw error;
  }
  if (canonical(document) !== canonical(raw.document) || !Number.isSafeInteger(raw.contentVersion) || Number(raw.contentVersion) < 1
    || !Number.isSafeInteger(raw.rowVersion) || Number(raw.rowVersion) < 1 || !Array.isArray(raw.sources)
    || !Array.isArray(raw.collaboratorUserIds) || raw.collaboratorUserIds.some(id => typeof id !== 'string')
    || typeof raw.professionalUserId !== 'string' || typeof raw.responsibleSectionDepartmentId !== 'string'
    || raw.ownerUserId !== null && typeof raw.ownerUserId !== 'string'
    || raw.analysisCompletedAt !== null && typeof raw.analysisCompletedAt !== 'string'
    || raw.submittedAt !== null && typeof raw.submittedAt !== 'string') supplierReportFail('SNAPSHOT_INVALID');
  const problem = supplierReportObject(raw.problem), instance = supplierReportObject(raw.instance), deadlines = supplierReportObject(raw.deadlines);
  const date = (value: unknown) => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));
  const currentSupplement = !supplier && !revision && !!record.control.closedAt;
  if (typeof problem.reportNumber !== 'string' || !problem.reportNumber || typeof problem.createdAt !== 'string' || !date(problem.createdAt) || !date(problem.closedAt)
    || currentSupplement && problem.supplementUpdatedAt !== undefined && !date(problem.supplementUpdatedAt)
    || !Number.isSafeInteger(instance.version) || Number(instance.version) < 1 || !date(raw.analysisCompletedAt) || !date(raw.submittedAt)
    || ['analysisDueAt', 'submissionDueAt', 'closureDueAt'].some(key => !date(deadlines[key]))) supplierReportFail('SNAPSHOT_INVALID');
  // Allowlist the wire snapshot; never return server evidence/object keys or arbitrary core fields.
  const snapshot: ProcessEightDReportSnapshotDto = {
    document, sources: supplier ? [] : raw.sources as ProcessEightDReportSnapshotDto['sources'],
    problem: Object.fromEntries(['reportNumber', 'severity', 'createdAt', 'closedAt', 'title', 'materialCode', 'materialCategory', 'defectDescription', 'defectQuantity',
      ...(currentSupplement ? ['supplementUpdatedAt'] : [])]
      .filter(key => problem[key] !== undefined).map(key => [key, problem[key]])),
    instance: Object.fromEntries(['id', 'version', 'status'].filter(key => instance[key] !== undefined).map(key => [key, instance[key]])),
    deadlines: Object.fromEntries(['analysisDueAt', 'submissionDueAt', 'closureDueAt'].map(key => [key, deadlines[key] as string | null])),
    contentVersion: Number(raw.contentVersion), rowVersion: Number(raw.rowVersion), ownerUserId: raw.ownerUserId as string | null,
    professionalUserId: raw.professionalUserId, responsibleSectionDepartmentId: raw.responsibleSectionDepartmentId,
    collaboratorUserIds: supplier ? [] : raw.collaboratorUserIds as string[], analysisCompletedAt: raw.analysisCompletedAt as string | null, submittedAt: raw.submittedAt as string | null,
  };
  const rounds = raw.approvalRounds ?? (raw.approval ? [raw.approval] : undefined);
  if (rounds !== undefined) {
    if (!Array.isArray(rounds)) supplierReportFail('SNAPSHOT_INVALID');
    snapshot.approvalRounds = rounds.map(value => {
      const round = supplierReportObject(value);
      return { ...Object.fromEntries(['id', 'roundNumber', 'status', 'contentVersion', 'version', 'createdAt', 'updatedAt'].map(key => [key, round[key]])),
        duties: (Array.isArray(round.duties) ? round.duties : []).map(value => {
          const duty = supplierReportObject(value);
          return Object.fromEntries(['id', 'duty', 'status', 'userId', 'decidedBy', 'decidedAt', ...supplier ? [] : ['comment']].map(key => [key, duty[key]]));
        }) };
    });
  }
  const status = revision ? query.revisionId ? 'HISTORICAL' : 'APPROVED'
    : record.control.closedAt ? 'CLOSED_SUPPLEMENT' : result.inReview ? 'IN_REVIEW' : 'DRAFT';
  const label = { DRAFT: '供应商8D草稿（未批准）', IN_REVIEW: '供应商8D待审版（未批准）', APPROVED: '供应商8D原批准版（固定快照）',
    HISTORICAL: '供应商8D历史修订（固定快照）', CLOSED_SUPPLEMENT: '供应商8D关闭后内部补充（非原批准版，不对供应商公开）' }[status];
  return { supplierProblemId: record.supplier.id, problemId: record.problem.id, reportNumber: problem.reportNumber,
    view: query.revisionId ? 'HISTORICAL' : revision ? 'APPROVED' : 'CURRENT', revisionId: revision?.id ?? null, status, label,
    contentVersion: snapshot.contentVersion, rowVersion: snapshot.rowVersion, generatedAt: new Date().toISOString(), snapshot, attachments: [] };
}
