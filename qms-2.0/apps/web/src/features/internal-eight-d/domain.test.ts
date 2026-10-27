import { expect, it } from 'vitest';
import { eightDDomain, type InternalEightDDomain } from './domain';
import { eightDPath } from '../process-eight-d/eight-d';

it.each([
  ['process', 'process-quality', 'process-eight-d'],
  ['customer', 'customer-quality', 'customer-eight-d'],
  ['new-product', 'new-product-quality', 'new-product-eight-d'],
] as const)('fixes %s paths, permission namespace and resource without accepting client descriptors', (domain, api, resource) => {
  const config = eightDDomain(domain);
  expect(config.basePath).toBe(`/api/v1/${api}/eight-d`);
  expect(config.resourceType).toBe(resource);
  expect(config.permissionPrefix).toBe(`${api}:issues`);
  expect(eightDPath('problem/id ?#', domain)).toBe(`/api/v1/${api}/eight-d/problem%2Fid%20%3F%23`);
  expect(Object.isFrozen(config)).toBe(true);
  expect(eightDDomain(domain)).toBe(config);
});

it('retains process defaults and rejects unknown/prototype domains rather than falling back', () => {
  expect(eightDDomain()).toBe(eightDDomain('process'));
  expect(eightDPath('p1')).toBe('/api/v1/process-quality/eight-d/p1');
  for (const domain of ['supplier', '__proto__', 'constructor', '/api/custom']) {
    expect(() => eightDDomain(domain as InternalEightDDomain)).toThrow('INTERNAL_EIGHT_D_DOMAIN_INVALID');
  }
});
