import { HttpException } from '@nestjs/common';
import { assertQuantities, normalizeItems, text } from '../../src/modules/supplier-incoming/supplier-incoming.rules.js';

function thrown(callback: () => unknown) { try { callback(); return null; } catch (error) { return (error as HttpException).getResponse() as { code: string }; } }

describe('supplier incoming rules', () => {
  it('requires positive quantities and bounded samples', () => {
    expect(() => assertQuantities(10, 11)).toThrow(HttpException);
    expect(() => assertQuantities(0, 1)).toThrow(HttpException);
    expect(() => assertQuantities(10, 11)).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'SUPPLIER_INCOMING_SAMPLE_EXCEEDS_RECEIPT' }) }));
  });

  it('normalizes and rejects duplicate item order', () => {
    expect(normalizeItems([{ order: 1, name: '外观', result: 'PASS' }])).toEqual([{ order: 1, name: '外观', measuredValue: null, result: 'PASS' }]);
    expect(() => normalizeItems([{ order: 1, name: '外观', result: 'PASS' }, { order: 1, name: '尺寸', result: 'NG' }])).toThrow(HttpException);
  });

  it('rejects blank text', () => {
    expect(() => text('  ', 100)).toThrow(HttpException);
    expect(thrown(() => text('  ', 100))).toEqual({ code: 'SUPPLIER_INCOMING_INPUT_INVALID', message: 'SUPPLIER_INCOMING_INPUT_INVALID' });
  });
});
