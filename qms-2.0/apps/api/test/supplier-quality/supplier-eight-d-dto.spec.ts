import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SaveSupplierEightDDto } from '../../src/modules/supplier-quality/supplier-eight-d.dto.js';
import { ProcessEightDDocumentDto } from '../../src/modules/process-quality/process-eight-d-document.dto.js';
import { normalizeProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';

describe('supplier full document HTTP boundary', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const transform = (document: unknown) => pipe.transform({ expectedRowVersion: 1, expectedInstanceVersion: 1, document }, { type: 'body', metatype: SaveSupplierEightDDto });
  it('uses the exact existing document prototype, not a subclass rejected by its normalizer', async () => {
    const dto = await transform({});
    expect(Object.getPrototypeOf(dto.document)).toBe(ProcessEightDDocumentDto.prototype);
    expect(() => normalizeProcessEightDDocument(dto.document)).not.toThrow();
  });
  it('retains the 100-distinct-file limit across the full body and rejects foreign fields', async () => {
    const ids = Array.from({ length: 101 }, () => randomUUID());
    const dto = await transform({ okFileIds: ids.slice(0, 100), ngFileIds: [ids[100]] });
    expect(() => normalizeProcessEightDDocument(dto.document)).toThrow();
    await expect(transform({ fabricatedRisk: 'LOW' })).rejects.toMatchObject({ status: 400 });
  });
});
