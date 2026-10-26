import 'reflect-metadata';
import { Prisma } from '../../src/generated/prisma/client.js';
import { WorkflowClosureRegistry } from '../../src/modules/workflow/workflow-closure-registry.js';
import type { WorkflowClosureAdapter } from '../../src/modules/workflow/workflow-closure-round.types.js';
import { ProblemDomainRegistry, type ProblemDomainReadAdapter } from '../../src/modules/problem-index/problem-domain-registry.js';

function closure(domainCode: string): WorkflowClosureAdapter {
  return { domainCode, lockAndRead: async () => { throw new Error('Not used by registration test'); }, complete: async () => {}, returnForChanges: async () => {} };
}
function reader(domainCode = 'process-quality', sourceType = 'process-defect'): ProblemDomainReadAdapter {
  return { domainCode, sourceType, visibilityPredicate: () => Prisma.sql`TRUE`, authorizeRead: async () => {},
    readSummaries: async () => new Map(), readWorkspace: async () => null, readReport: async () => null,
    listEvidenceReferences: async () => [], describeActions: async () => [] };
}
type MutableClosure = WorkflowClosureRegistry & { register(adapter: WorkflowClosureAdapter): void; onApplicationBootstrap(): void };
type MutableRead = ProblemDomainRegistry & { registerOverride(adapter: ProblemDomainReadAdapter): void; onApplicationBootstrap(): void };

describe('server-owned domain adapter bootstrap registration', () => {
  it('registers the process closure adapter before bootstrap without activating other domains', () => {
    const registry = new WorkflowClosureRegistry([]) as MutableClosure;
    const adapter = closure('process-quality');
    registry.register(adapter);
    expect(registry.get('process-quality')).toBe(adapter);
    expect(registry.hasDomain('supplier-quality')).toBe(false);
    expect(() => registry.register(closure('process-quality'))).toThrow();
    expect(() => registry.register(closure(' process-quality '))).toThrow();
    registry.onApplicationBootstrap();
    expect(() => registry.register(closure('customer-quality'))).toThrow();
    expect(registry.hasDomain('customer-quality')).toBe(false);
  });

  it('replaces only one existing read adapter at bootstrap and retains unrelated legacy readers', () => {
    const old = reader(); const customer = reader('customer-quality', 'customer-complaint');
    const registry = new ProblemDomainRegistry([old, customer]) as MutableRead;
    const current = reader();
    registry.registerOverride(current);
    expect(registry.forProblem({ domainCode: current.domainCode, sourceType: current.sourceType, sourceId: 'source' })).toBe(current);
    expect(registry.forProblem({ domainCode: customer.domainCode, sourceType: customer.sourceType, sourceId: 'source' })).toBe(customer);
    expect(() => registry.registerOverride(reader())).toThrow();
    expect(() => registry.registerOverride(reader('unknown', 'source'))).toThrow();
    registry.onApplicationBootstrap();
    expect(() => registry.registerOverride(reader('customer-quality', 'customer-complaint'))).toThrow();
  });

  it('preserves revision resource validation for replacement adapters', () => {
    const registry = new ProblemDomainRegistry([reader()]) as MutableRead;
    const invalid = { ...reader(), revisionResourceType: 'User', listRevisionIds: async () => [] };
    expect(() => registry.registerOverride(invalid)).toThrow('PROBLEM_DOMAIN_REGISTRATION_INVALID');
    expect(registry.forProblem({ domainCode: 'process-quality', sourceType: 'process-defect', sourceId: 'source' }).revisionResourceType).toBeUndefined();
  });
});
