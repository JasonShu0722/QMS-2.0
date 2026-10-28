import { expect, it } from 'vitest';
import { supplierEightDPath } from './supplier-eight-d';

it('uses distinct encoded internal and portal endpoints', () => {
  expect(supplierEightDPath('a/b', false)).toBe('/api/v1/supplier-quality/eight-d/a%2Fb');
  expect(supplierEightDPath('a/b', true)).toBe('/api/v1/supplier-portal/eight-d/a%2Fb');
});
