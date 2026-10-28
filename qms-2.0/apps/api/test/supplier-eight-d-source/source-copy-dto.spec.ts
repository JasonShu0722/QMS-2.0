import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SupplierCopyDraftInputDto, SupplierCopyPreviewInputDto } from '../../src/modules/supplier-eight-d-source/supplier-eight-d-source.dto.js';

const options = { whitelist: true, forbidNonWhitelisted: true };
describe('supplier COPY FACTS bounded explicit envelopes', () => {
  it('requires an explicit complete draft, with no file IDs or default risk/quantity', async () => {
    for (const value of [{ token: randomUUID() }, { token: randomUUID(), draft: {} }, { token: randomUUID(), draft: null }]) {
      expect((await validate(plainToInstance(SupplierCopyDraftInputDto, value), options)).length).toBeGreaterThan(0);
    }
    const draft = { profileId: randomUUID(), title: 'Reviewed draft', materialCode: 'PART', defectDescription: 'Reviewed fact', defectQuantity: 2,
      severity: 'LOW', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER' };
    expect(await validate(plainToInstance(SupplierCopyDraftInputDto, { token: randomUUID(), draft }), options)).toEqual([]);
    for (const field of ['defectQuantity', 'severity']) {
      const incomplete: Record<string, unknown> = { ...draft }; delete incomplete[field];
      expect((await validate(plainToInstance(SupplierCopyDraftInputDto, { token: randomUUID(), draft: incomplete }), options)).length).toBeGreaterThan(0);
    }
    expect((await validate(plainToInstance(SupplierCopyDraftInputDto, { token: randomUUID(), draft: { ...draft, fileIds: [randomUUID()] } }), options)).length).toBeGreaterThan(0);
  });

  it('accepts only fixed typed versioned sources in a nonempty list bounded to 100', async () => {
    const source = { kind: 'PROCESS_LEDGER', sourceId: randomUUID(), sourceVersion: 1 };
    const dto = { supplierProfileId: randomUUID(), sources: [source] };
    expect(await validate(plainToInstance(SupplierCopyPreviewInputDto, dto), options)).toEqual([]);
    for (const sources of [[], Array.from({ length: 101 }, () => source), [{ ...source, sourceVersion: 0 }], [{ ...source, kind: 'ARBITRARY_SOURCE' }], [{ ...source, rawJson: {} }], [{ ...source, fileIds: [randomUUID()] }]]) {
      expect((await validate(plainToInstance(SupplierCopyPreviewInputDto, { ...dto, sources }), options)).length).toBeGreaterThan(0);
    }
  });
});
