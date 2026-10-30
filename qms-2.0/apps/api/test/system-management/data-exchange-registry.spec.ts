import { DataExchangeRegistryService } from '../../src/modules/system-management/data-exchange-registry.service.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
describe('internal exchange source capabilities', () => {
  it('starts with an empty production directory and seals registration', async () => {
    const registry = new DataExchangeRegistryService();
    expect(await registry.sources(organizationId)).toEqual([]);
    registry.onApplicationBootstrap();
    expect(() => registry.register({ key: 'TECHNICAL_TEST', label: 'Technical fixture', directions: ['INBOUND'], objectTypes: ['FIXTURE'], authorizeScope: async () => true })).toThrow();
  });
  it('binds an opaque scope only after the source owner validates it and rejects forged capabilities', async () => {
    const registry = new DataExchangeRegistryService();
    const handle = registry.register({ key: 'TECHNICAL_TEST', label: 'Technical fixture', directions: ['INBOUND'], objectTypes: ['FIXTURE'], authorizeScope: async id => id === organizationId });
    const scope = await registry.bindScope(handle, organizationId);
    expect(registry.resolve(handle, scope, 'INBOUND', 'FIXTURE')).toEqual({ sourceKey: 'TECHNICAL_TEST', scopeKey: organizationId });
    await expect(registry.bindScope(handle, '22222222-2222-4222-8222-222222222222')).rejects.toMatchObject({ status: 403 });
    expect(() => registry.resolve({} as never, scope, 'INBOUND', 'FIXTURE')).toThrow();
    expect(() => registry.resolve(handle, {} as never, 'INBOUND', 'FIXTURE')).toThrow();
    expect(() => registry.resolve(handle, scope, 'OUTBOUND', 'FIXTURE')).toThrow();
  });
  it('limits source metadata and reveals directory labels only for an authorized owner scope', async () => {
    const registry = new DataExchangeRegistryService();
    expect(() => registry.register({ key: 'https://private?token=SECRET', label: 'bad', directions: ['INBOUND'], objectTypes: ['FIXTURE'], authorizeScope: async () => true })).toThrow();
    registry.register({ key: 'TECHNICAL_TEST', label: 'Technical fixture', directions: ['INBOUND'], objectTypes: ['FIXTURE'], authorizeScope: async id => id === organizationId });
    expect(await registry.sources(organizationId)).toEqual([{ key: 'TECHNICAL_TEST', label: 'Technical fixture', directions: ['INBOUND'], objectTypes: ['FIXTURE'] }]);
    expect(await registry.sources('22222222-2222-4222-8222-222222222222')).toEqual([]);
  });
});
