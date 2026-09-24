import 'reflect-metadata';
import { CustomerQualityController } from '../../src/modules/customer-quality/customer-quality.controller.js';

describe('customer quality response contract', () => {
  it('publishes named response schemas for complaint, current state, and history routes', () => {
    const response = (method: keyof CustomerQualityController, status: number) =>
      Reflect.getMetadata('swagger/apiResponse', CustomerQualityController.prototype[method])?.[status];
    expect(response('complaints', 200)?.type?.name).toBe('CustomerComplaintDto');
    expect(response('complaints', 200)?.isArray).toBe(true);
    expect(response('complaint', 200)?.type?.name).toBe('CustomerComplaintDetailDto');
    expect(response('dispositionHistory', 200)?.type?.name).toBe('CustomerPhysicalDispositionDto');
    expect(response('analysisHistory', 200)?.type?.name).toBe('CustomerPhysicalAnalysisDto');
    expect(response('issue', 201)?.type?.name).toBe('CustomerIssueResultDto');
    expect(response('linkedIssues', 200)?.type?.name).toBe('CustomerIssueProblemDto');
    expect(response('changeIssueSources', 200)?.type?.name).toBe('CustomerIssueProblemDto');
    expect(response('linkedIssueHistory', 200)?.type?.name).toBe('CustomerIssueLinkHistoryDto');
  });
});
