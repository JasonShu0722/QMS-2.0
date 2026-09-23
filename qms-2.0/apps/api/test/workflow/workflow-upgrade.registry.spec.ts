import type { ProblemIndex } from '../../src/generated/prisma/client.js';
import { WorkflowUpgradeRegistry, type WorkflowUpgradeDomainAdapter } from '../../src/modules/workflow/workflow-upgrade.registry.js';

describe('workflow upgrade adapter registration', () => {
  const adapter = { domainCode: 'supplier-quality', sourceType: 'supplier-quality' } as WorkflowUpgradeDomainAdapter;
  const problem = { domainCode: 'supplier-quality', sourceType: 'supplier-quality', sourceId: 'supplier-source' } as ProblemIndex;

  it('registers a domain after construction without mutating the provider array', () => {
    const providers: WorkflowUpgradeDomainAdapter[] = [];
    const registry = new WorkflowUpgradeRegistry(providers);
    registry.register(adapter);
    expect(registry.forProblem(problem)).toBe(adapter);
    expect(providers).toEqual([]);
  });

  it('rejects duplicate domain and source pairs', () => {
    const registry = new WorkflowUpgradeRegistry([adapter]);
    expect(() => registry.register(adapter)).toThrow('WORKFLOW_UPGRADE_ADAPTER_DUPLICATE');
  });
});
