import 'reflect-metadata';
import { CustomerQualityController } from '../../src/modules/customer-quality/customer-quality.controller.js';
import { CustomerQualityService } from '../../src/modules/customer-quality/customer-quality.service.js';
import type { PrismaService } from '../../src/database/prisma.service.js';
import type { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import type { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';

describe('customer quality response contract', () => {
  it('publishes named response schemas for complaint, current state, and history routes', () => {
    const response = (method: keyof CustomerQualityController, status: number) =>
      Reflect.getMetadata('swagger/apiResponse', CustomerQualityController.prototype[method])?.[status];
    expect(response('complaints', 200)?.type?.name).toBe('CustomerComplaintDto');
    expect(response('complaints', 200)?.isArray).toBe(true);
    expect(response('importComplaints', 201)?.type?.name).toBe('CustomerComplaintImportResultDto');
    expect(response('complaint', 200)?.type?.name).toBe('CustomerComplaintDetailDto');
    expect(response('dispositionHistory', 200)?.type?.name).toBe('CustomerPhysicalDispositionDto');
    expect(response('analysisHistory', 200)?.type?.name).toBe('CustomerPhysicalAnalysisDto');
    expect(response('issue', 201)?.type?.name).toBe('CustomerIssueResultDto');
    expect(response('linkedIssues', 200)?.type?.name).toBe('CustomerIssueProblemDto');
    expect(response('changeIssueSources', 200)?.type?.name).toBe('CustomerIssueProblemDto');
    expect(response('linkedIssueHistory', 200)?.type?.name).toBe('CustomerIssueLinkHistoryDto');
  });
});

it('rejects oversized severity snapshots before a customer complaint mutation', async () => {
  const service = new CustomerQualityService({} as PrismaService, {} as AdminMutationService, {} as AuditLogService);
  const actor = { id: 'f7bb6ba0-360c-4fd9-9bf9-d3e74d500fa1', organizationId: 'e8812252-3411-4e62-8861-a7e4c2b6811c', sessionId: '67702c9a-f3eb-4332-8a79-999e9796e8c7', accountType: 'INTERNAL' as const };
  await expect(service.createComplaint(actor, {
    customerId: '34de40ec-2989-4479-b0e3-f89d15b0cfaa', complaintType: 'ZERO_KM', defectDescription: '尺寸异常', severity: 'HIGH', severityPolicyVersion: 'v1', severitySnapshot: { detail: 'x'.repeat(10001) },
  }, 'trace', 'key')).rejects.toMatchObject({ status: 400 });
});
