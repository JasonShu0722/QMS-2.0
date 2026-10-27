import 'reflect-metadata';
import { ProcessEightDService } from '../../src/modules/process-quality/process-eight-d.service.js';

const modulePath = '../../src/common/eight-d/internal-eight-d-domain.js';

describe('fixed internal 8D domain boundary', () => {
  it('exports only the three approved immutable server descriptors', async () => {
    const domain = await import(modulePath).catch(() => null);
    expect(domain).not.toBeNull();
    const descriptors = domain!.INTERNAL_EIGHT_D_DOMAINS;
    expect(Object.keys(descriptors)).toEqual(['PROCESS', 'CUSTOMER', 'NEW_PRODUCT']);
    for (const descriptor of Object.values(descriptors)) expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptors)).toBe(true);
  });

  it('defaults the original 13-argument constructor and prototype fixtures to PROCESS', async () => {
    const domain = await import(modulePath).catch(() => null);
    expect(domain).not.toBeNull();
    const service = Reflect.construct(ProcessEightDService, Array(13).fill(undefined));
    expect(service.domain).toBe(domain!.INTERNAL_EIGHT_D_DOMAINS.PROCESS);
    expect(Object.create(ProcessEightDService.prototype).domain).toBe(domain!.INTERNAL_EIGHT_D_DOMAINS.PROCESS);
  });

  it('rejects descriptor copies, SQL injection and an unapproved fourth domain', async () => {
    const domain = await import(modulePath).catch(() => null);
    expect(domain).not.toBeNull();
    for (const descriptor of [
      { ...domain!.INTERNAL_EIGHT_D_DOMAINS.PROCESS },
      { ...domain!.INTERNAL_EIGHT_D_DOMAINS.CUSTOMER, storagePrefix: 'customer_eight_d; DROP TABLE users' },
      { domainCode: 'supplier-quality' }, null,
    ]) {
      expect(() => Reflect.construct(ProcessEightDService, [...Array(13).fill(undefined), descriptor])).toThrow();
      expect(() => domain!.internalEightDSql(descriptor)).toThrow();
    }
  });

  it('binds exact source, permission and report identities without cross-domain aliases', async () => {
    const domain = await import(modulePath);
    expect(Object.values(domain.INTERNAL_EIGHT_D_DOMAINS)).toEqual([
      { domainCode: 'process-quality', sourceDomain: 'process-quality', sourceType: 'process-defect', problemType: 'PROCESS_DEFECT',
        permissionPrefix: 'process-quality:issues', sourceReadPermission: 'process-quality:defects:read',
        resourceType: 'process-eight-d', revisionType: 'ProcessEightDRevision', storagePrefix: 'process_eight_d' },
      { domainCode: 'customer-quality', sourceDomain: 'customer-quality', sourceType: 'customer-complaint', problemType: 'CUSTOMER_COMPLAINT',
        permissionPrefix: 'customer-quality:issues', sourceReadPermission: 'customer-quality:complaints:read',
        resourceType: 'customer-eight-d', revisionType: 'CustomerEightDRevision', storagePrefix: 'customer_eight_d' },
      { domainCode: 'new-product-quality', sourceDomain: 'new-product-quality', sourceType: 'new-product-defect-selection', problemType: 'NEW_PRODUCT_ISSUE',
        permissionPrefix: 'new-product-quality:issues', sourceReadPermission: 'new-product-quality:projects:read',
        resourceType: 'new-product-eight-d', revisionType: 'NewProductEightDRevision', storagePrefix: 'new_product_eight_d' },
    ]);
  });
});
