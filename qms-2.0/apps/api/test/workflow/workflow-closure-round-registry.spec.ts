import 'reflect-metadata';
import { WorkflowClosureRegistry } from '../../src/modules/workflow/workflow-closure-registry.js';
import type { WorkflowClosureAdapter } from '../../src/modules/workflow/workflow-closure-round.types.js';

describe('trusted closure registry', () => {
  const adapter: WorkflowClosureAdapter = {
    domainCode: 'ExactDomain',
    async lockAndRead() { throw new Error('Not a production adapter'); },
    async complete() {},
    async returnForChanges() {},
  };
  it('uses exact domain matching, exposes readiness and refuses unregistered domains', () => {
    const registry = new WorkflowClosureRegistry([adapter]);
    expect(registry.hasDomain('ExactDomain')).toBe(true);
    expect(registry.hasDomain('exactdomain')).toBe(false);
    expect(registry.get('ExactDomain')).toBe(adapter);
    expect(() => registry.get('exactdomain')).toThrow(expect.objectContaining({ status: 409 }));
    expect(new WorkflowClosureRegistry([]).hasDomain('ExactDomain')).toBe(false);
  });
  it('rejects duplicate/empty domains and copies the injected array', () => {
    expect(() => new WorkflowClosureRegistry([adapter, adapter])).toThrow();
    expect(() => new WorkflowClosureRegistry([{ ...adapter, domainCode: '' }])).toThrow();
    const adapters = [adapter];
    const registry = new WorkflowClosureRegistry(adapters);
    adapters.length = 0;
    expect(registry.hasDomain('ExactDomain')).toBe(true);
  });
});
