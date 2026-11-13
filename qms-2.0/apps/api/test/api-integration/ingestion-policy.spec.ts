import { describe, expect, it } from '@jest/globals';
import { evaluateIngestionRow, normalizeIngestionRule } from '../../src/modules/api-integration/ingestion.policy.js';

const rule = { name: '供应商', endpointId: '550e8400-e29b-41d4-a716-446655440000', target: 'SUPPLIER', enabled: true, match: 'ALL', conditions: [{ path: 'kind', operator: 'EQ', value: 'supplier' }], mapping: { code: 'code', name: 'name', contactName: 'contact.name' }, mode: 'UPDATE', updateFields: ['name', 'contactName'] };

describe('API ingestion rule policy', () => {
  it('preserves leading zeroes and omits empty optional fields', () => {
    expect(evaluateIngestionRow(normalizeIngestionRule(rule), { kind: 'supplier', code: ' 001 ', name: ' Name ', contact: { name: null } })).toEqual({ matched: true, fields: { code: '001', name: 'Name' }, sourceUpdatedAt: null });
  });
  it('does not treat missing fields as not equal or empty', () => {
    for (const operator of ['NE', 'NOT_IN', 'EMPTY']) {
      const normalized = normalizeIngestionRule({ ...rule, conditions: [{ path: 'kind', operator, ...(operator === 'EMPTY' ? {} : { value: operator === 'NOT_IN' ? ['supplier'] : 'supplier' }) }] });
      expect(() => evaluateIngestionRow(normalized, { code: '001', name: 'Name' })).toThrow('INGESTION_FIELD_MISSING');
    }
  });
  it('rejects condition type mismatch instead of matching inequality', () => {
    expect(() => evaluateIngestionRow(normalizeIngestionRule({ ...rule, conditions: [{ path: 'kind', operator: 'NE', value: 1 }] }), { kind: '1', code: '001', name: 'Name' })).toThrow('INGESTION_FIELD_TYPE');
  });
  it('distinguishes filtered rows and invalid business fields', () => {
    expect(evaluateIngestionRow(normalizeIngestionRule(rule), { kind: 'customer' })).toEqual({ matched: false });
    expect(() => evaluateIngestionRow(normalizeIngestionRule(rule), { kind: 'supplier', code: 1, name: 'Name' })).toThrow('INGESTION_FIELD_TYPE');
  });
  it('rejects prototype paths and fields outside target ownership', () => {
    expect(() => normalizeIngestionRule({ ...rule, mapping: { code: '__proto__.code', name: 'name' } })).toThrow('INGESTION_RULE_INVALID');
    expect(() => normalizeIngestionRule({ ...rule, target: 'COMPONENT' })).toThrow('INGESTION_RULE_INVALID');
  });
  it('requires explicit source timestamp validity', () => {
    const normalized = normalizeIngestionRule({ ...rule, sourceUpdatedAtField: 'updatedAt' });
    expect(() => evaluateIngestionRow(normalized, { kind: 'supplier', code: '001', name: 'Name', updatedAt: 'yesterday' })).toThrow('INGESTION_SOURCE_VERSION_INVALID');
    expect(evaluateIngestionRow(normalized, { kind: 'supplier', code: '001', name: 'Name', updatedAt: '2026-11-14T00:00:00Z' })).toMatchObject({ sourceUpdatedAt: '2026-11-14T00:00:00.000Z' });
  });
  it('rejects nonexistent calendar dates before they can become source watermarks', () => {
    const normalized = normalizeIngestionRule({ ...rule, sourceUpdatedAtField: 'updatedAt' });
    for (const updatedAt of ['2026-02-30T00:00:00Z', '2026-02-29T12:30:00+08:00', '2026-04-31T23:59:59.123Z']) {
      expect(() => evaluateIngestionRow(normalized, { kind: 'supplier', code: '001', name: 'Name', updatedAt })).toThrow('INGESTION_SOURCE_VERSION_INVALID');
    }
  });
  it('accepts a real leap day while retaining timezone and millisecond precision limits', () => {
    const normalized = normalizeIngestionRule({ ...rule, sourceUpdatedAtField: 'updatedAt' });
    expect(evaluateIngestionRow(normalized, { kind: 'supplier', code: '001', name: 'Name', updatedAt: '2028-02-29T12:30:00.123+08:00' })).toMatchObject({ sourceUpdatedAt: '2028-02-29T04:30:00.123Z' });
    for (const updatedAt of ['2028-02-29T12:30:00', '2028-02-29T12:30:00.1234Z']) {
      expect(() => evaluateIngestionRow(normalized, { kind: 'supplier', code: '001', name: 'Name', updatedAt })).toThrow('INGESTION_SOURCE_VERSION_INVALID');
    }
  });
  it('rejects NUL values before database queue locks receive source text', () => {
    expect(() => evaluateIngestionRow(normalizeIngestionRule(rule), { kind: 'supplier', code: 'bad\u0000code', name: 'Name' })).toThrow('INGESTION_FIELD_INVALID');
  });
  it('identifies the controlled source path for condition, mapping and source timestamp errors', () => {
    const cases = [
      { configuration: rule, row: { code: '001', name: 'Name' }, code: 'INGESTION_FIELD_MISSING', field: 'kind' },
      { configuration: { ...rule, mapping: { code: 'payload.code', name: 'name' } }, row: { kind: 'supplier', payload: { code: 1 }, name: 'private-value' }, code: 'INGESTION_FIELD_TYPE', field: 'payload.code' },
      { configuration: { ...rule, sourceUpdatedAtField: 'meta.updatedAt' }, row: { kind: 'supplier', code: '001', name: 'Name', meta: { updatedAt: 'private-value' } }, code: 'INGESTION_SOURCE_VERSION_INVALID', field: 'meta.updatedAt' },
    ];
    for (const item of cases) {
      let response: unknown;
      try { evaluateIngestionRow(normalizeIngestionRule(item.configuration), item.row); } catch (error) { response = (error as { getResponse(): unknown }).getResponse(); }
      expect(response).toMatchObject({ code: item.code, field: item.field });
      expect(JSON.stringify(response)).not.toContain('private-value');
    }
  });
});
