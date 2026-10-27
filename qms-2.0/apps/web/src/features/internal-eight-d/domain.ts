export type InternalEightDDomain = 'process' | 'customer' | 'new-product';

const domains = Object.freeze({
  process: Object.freeze({ basePath: '/api/v1/process-quality/eight-d', resourceType: 'process-eight-d', permissionPrefix: 'process-quality:issues', title: ['过程 8D', 'Process 8D'], label: ['正式过程 8D 工作区', 'Formal process 8D workspace'] } as const),
  customer: Object.freeze({ basePath: '/api/v1/customer-quality/eight-d', resourceType: 'customer-eight-d', permissionPrefix: 'customer-quality:issues', title: ['客户 8D', 'Customer 8D'], label: ['正式客户 8D 工作区', 'Formal customer 8D workspace'] } as const),
  'new-product': Object.freeze({ basePath: '/api/v1/new-product-quality/eight-d', resourceType: 'new-product-eight-d', permissionPrefix: 'new-product-quality:issues', title: ['新品 8D', 'New product 8D'], label: ['正式新品 8D 工作区', 'Formal new product 8D workspace'] } as const),
});

export function eightDDomain(domain: InternalEightDDomain = 'process') {
  if (!Object.hasOwn(domains, domain)) throw new Error('INTERNAL_EIGHT_D_DOMAIN_INVALID');
  return domains[domain];
}
