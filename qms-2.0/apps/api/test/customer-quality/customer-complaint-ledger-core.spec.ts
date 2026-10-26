import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CustomerLedgerCreateDto, CustomerLedgerFieldsDto, CustomerLedgerImportDto, CustomerLedgerItemDto, CustomerLedgerReceivingDto } from '../../src/modules/customer-quality/customer-complaint-ledger.dto.js';
import { ComponentProjectResolutionDto } from '../../src/modules/platform-configuration/component-project.dto.js';
import { normalizeComplaintFields, mergeComplaintSupplement, ledgerDisplayStatus } from '../../src/modules/customer-quality/customer-complaint-ledger.types.js';

const errors = async (type: new () => object, value: object) => validate(plainToInstance(type, value), { whitelist: true, forbidNonWhitelisted: true });

describe('formal complaint ledger trust envelope and preserved content', () => {
  it('accepts unknown row content, without customer, risk or engineer requirements', async () => {
    expect(await errors(CustomerLedgerCreateDto, { fields: { complaintType: 'AFTER_SALES', quantity: '原文待补', occurredOn: '2026-02-30', mileage: { value: -1 } } })).toEqual([]);
  });
  it('rejects impersonation, unrecognized fields, malformed references and oversized raw input', async () => {
    for (const input of [
      { fields: {}, createdById: 'someone' }, { fields: { ownerUserId: 'someone' } },
      { fields: {}, customerId: 'not-a-uuid' }, { fields: {}, qualityEngineerAssignmentId: '张工' },
      { fields: { defectDescription: 'x'.repeat(20001) } }, { fields: [] },
    ]) expect((await errors(CustomerLedgerCreateDto, input)).length).toBeGreaterThan(0);
  });
  it('bounds batches and enforces per-row identity and supplement CAS', async () => {
    const row = { rowNumber: 1, action: 'ADD', fields: {} };
    expect(await errors(CustomerLedgerImportDto, { mode: 'CONTINUE', rows: [row] })).toEqual([]);
    for (const rows of [[], Array.from({ length: 101 }, (_, i) => ({ ...row, rowNumber: i + 1 })), [row, row], [{ ...row, action: 'SUPPLEMENT' }]]) {
      expect((await errors(CustomerLedgerImportDto, { mode: 'CONTINUE', rows })).length).toBeGreaterThan(0);
    }
  });
  it('receiving cannot smuggle another quantity or analysis update', async () => {
    expect(await errors(CustomerLedgerReceivingDto, { expectedVersion: 1, courierNumber: 'SF-1', receivedOn: '2026-10-26' })).toEqual([]);
    expect((await errors(CustomerLedgerReceivingDto, { expectedVersion: 1, quantity: 5 })).length).toBeGreaterThan(0);
  });
  it('retains raw invalids and never substitutes a quantity, risk, date, mileage or classification', () => {
    const result = normalizeComplaintFields({ quantity: '原文待补', occurredOn: '2026-02-30', mileage: -1, serviceMode: 'unknown', complaintType: 'other' });
    expect(result.raw.quantity).toBe('原文待补');
    expect(result.normalized).toMatchObject({ quantity: null, occurredOn: null, mileage: null, serviceMode: null, complaintType: null });
    expect(result.warnings.map(item => item.field)).toEqual(expect.arrayContaining(['quantity', 'occurredOn', 'mileage', 'serviceMode', 'complaintType']));
    expect(normalizeComplaintFields({}).normalized.quantity).toBeNull();
    expect(normalizeComplaintFields({}).normalized.complaintType).toBeNull();
  });
  it('normalizes valid dates and single quantity consistently but not arbitrary numeric strings', () => {
    expect(normalizeComplaintFields({ complaintType: 'AFTER_SALES', quantity: '2', mileage: '5000', productionOn: '2026-01-31' }).normalized)
      .toMatchObject({ quantity: 2, mileage: 5000, productionOn: '2026-01-31' });
    for (const value of ['1e3', '0x10', -1, 1.2, '']) expect(normalizeComplaintFields({ quantity: value }).normalized.quantity).toBeNull();
    expect(() => normalizeComplaintFields({ quantity: Infinity })).toThrow();
  });
  it.each([['零公里', 'ZERO_KM'], ['售后', 'AFTER_SALES']])('normalizes the Chinese complaint type %s without changing the original cell', (raw, canonical) => {
    const result = normalizeComplaintFields({ complaintType: raw });
    expect(result.raw.complaintType).toBe(raw);
    expect(result.normalized.complaintType).toBe(canonical);
    expect(result.warnings.some(warning => warning.field === 'complaintType')).toBe(false);
    const padded = normalizeComplaintFields({ complaintType: `${raw} ` });
    expect(padded.raw.complaintType).toBe(`${raw} `);
    expect(padded.normalized.complaintType).toBe(canonical);
  });
  it('supplements explicit facts only, ignoring empty cells and protecting engineer/analysis/attachments', () => {
    const original = { vin: 'old', quantity: 2, defectDescription: 'original' };
    expect(mergeComplaintSupplement(original, { vin: '', quantity: null, defectDescription: 'new' })).toEqual({ vin: 'old', quantity: 2, defectDescription: 'new' });
    expect(() => mergeComplaintSupplement(original, { qualityEngineerId: 'x' } as never)).toThrow();
  });
  it('projects legacy states without changing historical facts', () => {
    for (const state of ['OPEN', 'IN_ANALYSIS', 'RESOLVED']) expect(ledgerDisplayStatus(null, state)).toBe('FOLLOWING');
    for (const state of ['CLOSED', 'ARCHIVED']) expect(ledgerDisplayStatus(null, state)).toBe('CLOSED');
    expect(ledgerDisplayStatus('FOLLOWING', 'CLOSED')).toBe('FOLLOWING');
  });
  it('describes raw JSON unions and the actual public component mapping response in Swagger', () => {
    const raw = Reflect.getMetadata('swagger/apiModelProperties', CustomerLedgerFieldsDto.prototype, 'quantity');
    expect(raw.nullable).toBe(true);
    expect(raw.oneOf.map((schema: { type: string }) => schema.type)).toEqual(['string','number','boolean','array','object']);
    expect(Reflect.getMetadata('swagger/apiModelProperties', CustomerLedgerItemDto.prototype, 'mapping').type).toBe(ComponentProjectResolutionDto);
  });
});
