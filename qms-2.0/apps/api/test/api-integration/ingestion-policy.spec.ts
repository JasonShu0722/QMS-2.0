import { describe, expect, it } from '@jest/globals';
import { evaluateIngestionRow, normalizeIngestionRule, selectedDescriptionInput } from '../../src/modules/api-integration/ingestion.policy.js';

const rule = { name: '供应商', endpointId: '550e8400-e29b-41d4-a716-446655440000', target: 'SUPPLIER', enabled: true, match: 'ALL', conditions: [{ path: 'kind', operator: 'EQ', value: 'supplier' }], mapping: { code: 'code', name: 'name', contactName: 'contact.name' }, mode: 'UPDATE', updateFields: ['name', 'contactName'] };

describe('API ingestion rule policy', () => {
  it('maps operation identity and name from configurable paths and permits only name updates', () => {
    const operation = { ...rule, target: 'OPERATION', conditions: [], mapping: { operationCode: 'station.id', operationName: 'title' }, updateFields: ['operationName'] };
    const normalized = normalizeIngestionRule(operation);
    expect(evaluateIngestionRow(normalized, { station: { id: ' 0001 ' }, title: ' 测试工序 ', sectorName: '不应入库' })).toEqual({ matched: true, fields: { operationCode: '0001', operationName: '测试工序' }, sourceUpdatedAt: null });
    expect(() => evaluateIngestionRow(normalized, { station: { id: '0001' } })).toThrow('INGESTION_FIELD_MISSING');
    expect(() => evaluateIngestionRow(normalized, { station: { id: 1 }, title: '测试' })).toThrow('INGESTION_FIELD_TYPE');
    expect(() => normalizeIngestionRule({ ...operation, mapping: { operationName: 'title' } })).toThrow('INGESTION_RULE_INVALID');
    expect(() => normalizeIngestionRule({ ...operation, mapping: { ...operation.mapping, sectorName: 'sector' } })).toThrow('INGESTION_RULE_INVALID');
    expect(() => normalizeIngestionRule({ ...operation, updateFields: ['operationCode'] })).toThrow('INGESTION_RULE_INVALID');
  });
  it('retains an explicit published application binding and rejects unsafe or foreign-scene input shapes', () => {
    const binding = { applicationId: '550e8400-e29b-41d4-a716-446655440001', publishedVersion: 2, inputFields: [{ path: 'ims.fact', variable: 'fact' }] };
    const input = { ...rule, target: 'PROCESS_DEFECT', conditions: [], mapping: { description: 'direct' }, updateFields: ['description'], aiApplication: binding };
    expect(normalizeIngestionRule(input)).toHaveProperty('aiApplication', binding);
    for (const change of [{ publishedVersion: 0 }, { inputFields: [{ path: '__proto__.fact', variable: 'fact' }] }, { inputFields: [{ path: 'fact', variable: 'fact' }, { path: 'other', variable: 'fact' }] }]) {
      expect(() => normalizeIngestionRule({ ...input, aiApplication: { ...binding, ...change } })).toThrow();
    }
    expect(() => normalizeIngestionRule({ ...rule, aiApplication: binding })).toThrow();
  });
  const processRule = { ...rule, target: 'PROCESS_DEFECT', conditions: [], mapping: { externalRecordKey: 'id', occurredAt: 'time', productCode: 'product', traceCode: 'trace' }, updateFields: ['description', 'productCode'], sourceTimezone: 'Asia/Shanghai', descriptionComposition: { fields: [{ path: 'test', label: '测试：' }, { path: 'zero' }, { path: 'flag', label: '结果：' }, { path: 'empty', label: '' }], separator: '\n' } };
  it.each([
    [1, 'FACTORY_1', []], ['1', 'FACTORY_1', []],
    [2, 'FACTORY_2', []], ['2', 'FACTORY_2', []], [' 2 ', 'FACTORY_2', []],
    [undefined, null, ['factory:EMPTY']], [null, null, ['factory:EMPTY']],
    ['', null, ['factory:EMPTY']], ['  ', null, ['factory:EMPTY']],
    [3, null, ['factory:INVALID']], ['01', null, ['factory:INVALID']],
    [true, null, ['factory:INVALID']], [{ code: 1 }, null, ['factory:INVALID']],
    [[1], null, ['factory:INVALID']],
  ])('maps factory payload %p without rejecting the row', (value, factoryCode, issues) => {
    const config = normalizeIngestionRule({ ...processRule, mapping: { factoryCode: 'source.factory' } });
    const source = value === undefined ? {} : { factory: value };
    expect(evaluateIngestionRow(config, { source })).toMatchObject({ matched: true, fields: { factoryCode, issues } });
  });
  it('omits factory facts and issues for historical rules without a mapping', () => {
    const config = normalizeIngestionRule({ ...processRule, mapping: {} });
    expect(evaluateIngestionRow(config, { factory: '01' })).toEqual({ matched: true, fields: { issues: [] }, sourceUpdatedAt: null });
  });
  it('checks rule-owned variable mappings and excludes blank inputs without discarding zero or false', () => {
    const fields = [{ path: 'test', variable: 'fact' }, { path: 'zero', variable: 'quantity' }, { path: 'flag', variable: 'flag' }];
    const composition = { ...processRule, descriptionComposition: { fields, separator: '\n' } };
    const binding = { applicationId: '550e8400-e29b-41d4-a716-446655440001', publishedVersion: 2, inputFields: fields };
    expect(normalizeIngestionRule(composition).descriptionComposition?.fields).toEqual(fields);
    expect(() => normalizeIngestionRule({ ...composition, aiApplication: { ...binding, inputFields: [{ path: 'other', variable: 'fact' }] } })).toThrow('INGESTION_RULE_INVALID');
    expect(() => normalizeIngestionRule({ ...composition, descriptionComposition: { fields: [...fields, { path: 'other', variable: 'fact' }], separator: '\n' } })).toThrow('INGESTION_RULE_INVALID');
    const normalized = normalizeIngestionRule({ ...composition, aiApplication: binding, aiDescription: { connectionId: binding.applicationId, model: 'model', prompt: '{{fact}} {{quantity}} {{flag}}', inputFields: fields, output: { mode: 'TEXT', field: 'description', target: 'description' } } });
    expect(selectedDescriptionInput(normalized, { test: '  ', zero: 0, flag: false }).map(field => field.value)).toEqual([0, false]);
  });
  it('maps process facts without invented master-data keys and composes scalar description in order', () => {
    expect(evaluateIngestionRow(normalizeIngestionRule(processRule), { id: '001', time: '2026-11-16T08:30:00', product: '00002', trace: 'T', test: '失败', zero: 0, flag: false, empty: null })).toMatchObject({ matched: true, fields: { externalRecordKey: '001', occurredAt: '2026-11-16T00:30:00.000Z', productCode: '00002', traceCode: 'T', description: '测试：失败\n0\n结果：false' }, sourceUpdatedAt: null });
  });
  it('keeps process rows bookable when invalid or missing facts need completion', () => {
    const result = evaluateIngestionRow(normalizeIngestionRule(processRule), { time: '2026-02-30T00:00:00', product: 2, test: { secret: 'raw' }, zero: null, flag: null });
    expect(result).toMatchObject({ matched: true, fields: { issues: expect.arrayContaining(['occurredAt:INVALID', 'productCode:TYPE', 'description:TYPE']) } });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result).not.toHaveProperty('fields.occurredAt');
  });
  it('rejects derived field mappings, mixed description modes and unsupported process update fields', () => {
    for (const configuration of [
      { ...processRule, mapping: { projectCode: 'project' } },
      { ...processRule, mapping: { description: 'description' } },
      { ...processRule, updateFields: ['externalRecordKey'] },
      { ...processRule, sourceTimezone: 'not/a-zone' },
      { ...rule, descriptionComposition: processRule.descriptionComposition },
    ]) expect(() => normalizeIngestionRule(configuration)).toThrow('INGESTION_RULE_INVALID');
  });
  it('handles fractional timezone offsets and flags DST gaps or ambiguous wall times for completion', () => {
    expect(evaluateIngestionRow(normalizeIngestionRule({ ...processRule, sourceTimezone: 'Asia/Kathmandu' }), { time: '2026-11-16T08:30:00' })).toMatchObject({ fields: { occurredAt: '2026-11-16T02:45:00.000Z' } });
    for (const time of ['2026-03-08T02:30:00', '2026-11-01T01:30:00']) {
      const result = evaluateIngestionRow(normalizeIngestionRule({ ...processRule, sourceTimezone: 'America/New_York' }), { time });
      expect(result).toMatchObject({ fields: { issues: expect.arrayContaining(['occurredAt:INVALID']) } });
      expect(result).not.toHaveProperty('fields.occurredAt');
    }
  });
  it('extracts single-field scalar descriptions and keeps overlong compositions as completion issues without truncating', () => {
    const single = normalizeIngestionRule({ ...processRule, descriptionComposition: undefined, mapping: { description: 'value' } });
    for (const value of [0, false]) expect(evaluateIngestionRow(single, { value })).toMatchObject({ fields: { description: String(value) } });
    const combined = evaluateIngestionRow(normalizeIngestionRule(processRule), { test: '长'.repeat(10001) });
    expect(combined).toMatchObject({ fields: { issues: expect.arrayContaining(['description:INVALID']) } });
    expect(combined).not.toHaveProperty('fields.description');
  });
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
  it('accepts internal material-name lookup for component mappings without a report name field', () => {
    const component = { ...rule, target: 'COMPONENT', mapping: { code: 'partCode' }, conditions: [], updateFields: [], componentNameLookup: { source: 'MATERIAL', field: 'materialName' } };
    const normalized = normalizeIngestionRule(component);
    expect(normalized).toMatchObject({ target: 'COMPONENT', mapping: { code: 'partCode' }, componentNameLookup: { source: 'MATERIAL', field: 'materialName' } });
    expect(evaluateIngestionRow(normalized, { partCode: ' 00042 ' })).toEqual({ matched: true, fields: { code: '00042' }, sourceUpdatedAt: null });
  });
  it('keeps external component names required and rejects unsafe internal lookup shapes', () => {
    const component = { ...rule, target: 'COMPONENT', mapping: { code: 'partCode', name: 'partName' }, conditions: [], updateFields: [] };
    expect(() => normalizeIngestionRule({ ...component, componentNameLookup: { source: 'MATERIAL', field: 'materialName' } })).toThrow('INGESTION_RULE_INVALID');
    expect(() => normalizeIngestionRule({ ...component, mapping: { code: 'partCode' } })).toThrow('INGESTION_RULE_INVALID');
    for (const lookup of [
      { source: 'MATERIAL', field: 'materialCode' },
      { source: 'MATERIAL', field: 'materialName', extra: 'x' },
      { source: 'OTHER', field: 'materialName' },
    ]) expect(() => normalizeIngestionRule({ ...component, mapping: { code: 'partCode' }, componentNameLookup: lookup })).toThrow('INGESTION_RULE_INVALID');
    expect(() => normalizeIngestionRule({ ...rule, componentNameLookup: { source: 'MATERIAL', field: 'materialName' } })).toThrow('INGESTION_RULE_INVALID');
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
