import { INTERNAL_EIGHT_D_DOMAINS } from '../../src/common/eight-d/internal-eight-d-domain.js';
import { createInternalEightDRuntime } from '../../src/common/eight-d/internal-eight-d-runtime.js';

describe('domain runtime composition', () => {
  it.each([INTERNAL_EIGHT_D_DOMAINS.CUSTOMER, INTERNAL_EIGHT_D_DOMAINS.NEW_PRODUCT])('registers all adapters once for $domainCode and keeps the source port', domain => {
    const registered: unknown[] = [];
    const source = { sourceReference: async () => null, lockAndResolve: async () => null };
    const registry = { register: (adapter: unknown) => registered.push(adapter), registerOverride: (adapter: unknown) => registered.push(adapter) };
    const resources = { register: (adapter: unknown) => registered.push(adapter) };
    const runtime = createInternalEightDRuntime(domain, {} as never, source as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, resources as never, {} as never, {} as never,
      registry as never, {} as never, registry as never, {} as never, {} as never);
    expect(runtime.core.domain).toBe(domain);
    expect(runtime.core).toHaveProperty('ledger', source);
    expect(registered).toEqual([]);
    runtime.onModuleInit();
    expect(registered).toHaveLength(3);
    expect(registered).toContainEqual(expect.objectContaining({ domainCode: domain.domainCode }));
    expect(registered).toContainEqual(expect.objectContaining({ resourceType: domain.resourceType }));
    expect(registered).toContainEqual(expect.objectContaining({ sourceType: domain.sourceType, revisionResourceType: domain.revisionType }));
    expect(runtime.reminders.eventTypes).toContain(`${domain.storagePrefix.toUpperCase()}_REMINDER_DUE`);
    expect(runtime.report).toBeDefined();
    expect(runtime.tasks).toBeDefined();
  });
});
