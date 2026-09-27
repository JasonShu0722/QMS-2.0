import { validateConcessionRequest } from '../../src/modules/supplier-concession/supplier-concession.rules.js';

describe('supplier concession request rules', () => {
  const now = new Date('2026-09-24T10:00:00Z');

  it('accepts a bounded quantity and future expiry', () => {
    expect(validateConcessionRequest({ quantity: 8, receivedQuantity: 10, reason: '尺寸偏差已评估', expiresAt: new Date('2026-09-25T10:00:00Z') }, now)).toEqual({ quantity: 8, reason: '尺寸偏差已评估' });
  });

  it('rejects over-release, empty reason and an expired request', () => {
    expect(() => validateConcessionRequest({ quantity: 11, receivedQuantity: 10, reason: '评估', expiresAt: new Date('2026-09-25T10:00:00Z') }, now)).toThrow();
    expect(() => validateConcessionRequest({ quantity: 1, receivedQuantity: 10, reason: ' ', expiresAt: new Date('2026-09-25T10:00:00Z') }, now)).toThrow();
    expect(() => validateConcessionRequest({ quantity: 1, receivedQuantity: 10, reason: '评估', expiresAt: now }, now)).toThrow();
  });
});
