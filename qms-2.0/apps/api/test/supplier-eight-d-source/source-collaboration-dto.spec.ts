import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SupplierSourceCollaborationQueryDto } from '../../src/modules/supplier-eight-d-source/supplier-source-collaboration.dto.js';

describe('source collaboration bounded query', () => {
  const errors = (value: object) => validate(plainToInstance(SupplierSourceCollaborationQueryDto, value), { whitelist: true, forbidNonWhitelisted: true });
  it.each([{}, { organizationId: randomUUID(), cursor: randomUUID(), scanLimit: '1' }, { scanLimit: 100 }])('accepts %j', async value => {
    expect(await errors(value)).toEqual([]);
  });
  it.each([{ scanLimit: 0 }, { scanLimit: 101 }, { scanLimit: 1.5 }, { scanLimit: '1e2' }, { scanLimit: null }, { cursor: 'not-uuid' },
    { organizationId: null }, { total: 99 }, { sourceId: randomUUID() }, { complete: true }])('rejects %j', async value => {
    expect((await errors(value)).length).toBeGreaterThan(0);
  });
});
