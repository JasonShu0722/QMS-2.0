import { randomUUID } from 'node:crypto';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import type { SupplierEightDReportRead } from '../../src/modules/supplier-quality/supplier-eight-d-report.model.js';

export const id = randomUUID(), organizationId = randomUUID(), vendor = randomUUID(), revisionId = randomUUID();
export function reportRead(): SupplierEightDReportRead {
  return {
    record: { supplier: { id, supplierOrganizationId: vendor, releasedToSupplierAt: new Date('2026-10-28T00:00:00Z') },
      control: { organizationId, approvedRevisionId: null, closedAt: null }, problem: { id: randomUUID() }, node: { config: {} } },
    revision: null, privateSupplementFileIds: [], versionFingerprint: 'server-version-1',
    snapshot: { document: emptyProcessEightDDocument(), evidence: [], contentVersion: 2, rowVersion: 3,
      problem: { reportNumber: 'SUPPLIER-8D-001', severity: 'HIGH', createdAt: '2026-10-28T00:00:00Z', closedAt: null }, instance: { version: 4 },
      deadlines: { analysisDueAt: null, submissionDueAt: null, closureDueAt: null }, analysisCompletedAt: null, submittedAt: null,
      ownerUserId: randomUUID(), professionalUserId: randomUUID(), responsibleSectionDepartmentId: randomUUID(), collaboratorUserIds: [], sources: [] },
  };
}
