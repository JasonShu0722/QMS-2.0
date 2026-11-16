import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as dto from '../../src/modules/process-quality/process-quality.dto.js';

const options = { whitelist: true, forbidNonWhitelisted: true };
const id = '904385a2-4a34-4d73-a8bd-e670d332dbd9';

describe('manual process ledger DTO boundaries', () => {
  it('allows partial maintenance of unknown facts while new manual registration requires four facts', async () => {
    const body = plainToInstance(dto.UpdateProcessDefectDto, { expectedVersion: 1, description: '', responsibilityCategory: null, defectTypeCode: null, defectQuantity: null, occurredAt: null });
    expect(await validate(body, options)).toEqual([]);
    expect(body.defectQuantity).toBeNull();
    expect(body.occurredAt).toBeNull();
    expect((await validate(plainToInstance(dto.CreateProcessDefectDto, {}), options)).length).toBeGreaterThan(0);
    const manual = plainToInstance(dto.CreateProcessDefectDto, { description: '不良', occurredAt: '2026-11-16T00:30:00Z', productCode: '00001', traceCode: 'TRACE' });
    expect(await validate(manual, options)).toEqual([]);
    expect(manual.defectQuantity).toBe(1);
  });

  it('accepts FALSE_POSITIVE and multiple optional material groups but not forged verification', async () => {
    const facts = { description: '不良', occurredAt: '2026-11-16T00:30:00Z', productCode: '00001', traceCode: 'TRACE' };
    expect(await validate(plainToInstance(dto.CreateProcessDefectDto, { ...facts, responsibilityCategory: 'FALSE_POSITIVE', materials: [{}, { materialCode: 'M1', materialBatch: 'MB', sqeUserId: id }] }), options)).toEqual([]);
    for (const body of [{ materials: [{ verification: 'CONFIRMED_DEFECT' }] }, { materials: [null] }, { materials: [{ sqeUserId: 'SQE name' }] }, { materials: [{ unit: 'pcs' }] }, { ledgerStatus: 'CLOSED' }, { description: null }, { defectQuantity: 0 }, { defectQuantity: 2147483648 }]) {
      expect((await validate(plainToInstance(dto.CreateProcessDefectDto, { ...facts, ...body }), options)).length).toBeGreaterThan(0);
    }
  });

  it('requires a bounded, explicit, unique CAS selection for classification', async () => {
    expect(typeof dto.ClassifyProcessDefectsDto).toBe('function');
    const rows = [{ defectId: id, expectedVersion: 1 }];
    expect(await validate(plainToInstance(dto.ClassifyProcessDefectsDto, { sources: rows, responsibilityCategory: null }), options)).toEqual([]);
    for (const sources of [[], [...rows, ...rows], [{ defectId: id }], [null], Array.from({ length: 101 }, (_, i) => ({ defectId: `904385a2-4a34-4d73-a8bd-${String(i).padStart(12, '0')}`, expectedVersion: 1 }))]) {
      expect((await validate(plainToInstance(dto.ClassifyProcessDefectsDto, { sources, responsibilityCategory: 'PROCESS' }), options)).length).toBeGreaterThan(0);
    }
    expect((await validate(plainToInstance(dto.ClassifyProcessDefectsDto, { sources: rows }), options)).length).toBeGreaterThan(0);
  });

  it('separates close, mandatory reopen reason, and the four SQE conclusions', async () => {
    expect(typeof dto.ReopenProcessDefectDto).toBe('function');
    expect(await validate(plainToInstance(dto.CloseProcessDefectDto, { expectedVersion: 1 }), options)).toEqual([]);
    for (const reason of [undefined, null, '', '   ']) expect((await validate(plainToInstance(dto.ReopenProcessDefectDto, { expectedVersion: 1, reason }), options)).length).toBeGreaterThan(0);
    for (const verification of ['CONFIRMED_DEFECT', 'NOT_MATERIAL', 'NEGOTIATED', 'RETURN_ANALYSIS']) {
      expect(await validate(plainToInstance(dto.VerifyProcessDefectMaterialDto, { expectedVersion: 1, verification }), options)).toEqual([]);
    }
    expect((await validate(plainToInstance(dto.VerifyProcessDefectMaterialDto, { expectedVersion: 1, verification: 'UNREVIEWED' }), options)).length).toBeGreaterThan(0);
  });
});
