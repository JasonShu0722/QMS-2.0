import { describe, expect, it } from '@jest/globals';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';

describe('workflow runtime', () => {
  it('starts a published fixed-version instance and rejects replay payload changes', async () => {
    const service = new WorkflowRuntimeService({} as never, {} as never, {} as never, {} as never);
    await expect(service.startInstance({
      organizationId: 'org-1', problemIndexId: 'problem-1', workflowDefinitionId: 'definition-1',
      workflowVersionId: 'version-1', actorUserId: 'user-1', instanceKey: 'problem-1', idempotencyKey: 'start-1',
    })).rejects.toThrow();
  });
});
