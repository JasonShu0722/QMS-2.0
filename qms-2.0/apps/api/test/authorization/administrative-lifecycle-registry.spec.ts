import { describe, expect, it } from '@jest/globals';
import * as registryApi from '../../src/common/security/administrative-lifecycle.registry.js';
import type { AdministrativeLifecycleEffect } from '../../src/common/security/administrative-lifecycle.types.js';

describe('administrative lifecycle effects registration', () => {
  it('requires each real owning module, rejects duplicates and freezes before handling requests', async () => {
    const Registry = registryApi.AdministrativeLifecycleRegistry;
    const registry = new Registry();
    const calls: string[] = [];
    const effect = (module: AdministrativeLifecycleEffect['module']): AdministrativeLifecycleEffect => ({ module,
      apply: async () => { calls.push(module); return { module, changed: 1, pendingConfiguration: 2 }; } });
    expect(() => registry.seal()).toThrow('ADMIN_LIFECYCLE_EFFECTS_INCOMPLETE');
    registry.register(effect('identity'));
    expect(() => registry.register(effect('identity'))).toThrow('ADMIN_LIFECYCLE_EFFECT_DUPLICATE');
    registry.register(effect('platform-configuration'));
    registry.register(effect('workflow'));
    registry.seal();
    expect(() => registry.register(effect('workflow'))).toThrow('ADMIN_LIFECYCLE_EFFECTS_FROZEN');
    const results = await registry.apply({} as never, {} as never, {} as never);
    expect(calls).toEqual(['workflow', 'platform-configuration', 'identity']);
    expect(results).toEqual(calls.map(module => ({ module, changed: 1, pendingConfiguration: 2 })));
  });
});
