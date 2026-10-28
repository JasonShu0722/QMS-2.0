import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SupplierEightDTaskQueryDto } from '../../src/modules/supplier-quality/supplier-eight-d-task.dto.js';

describe('supplier 8D bounded task query', () => {
  const errors = (input: unknown) => validateSync(plainToInstance(SupplierEightDTaskQueryDto, input), { whitelist: true, forbidNonWhitelisted: true });
  it('accepts empty query and bounded numeric query strings', () => {
    expect(errors({})).toEqual([]);
    expect(errors({ pageSize: '100', cursor: '00000000-0000-4000-8000-000000000001' })).toEqual([]);
  });
  it.each([0, 101, -1, 1.5, 'NaN', '', true, [2]])('rejects invalid page size %j', pageSize => {
    expect(errors({ pageSize }).length).toBeGreaterThan(0);
  });
  it.each([{ cursor: 'bad' }, { supplierProblemId: 'bad' }, { organizationId: 'bad' }, { offset: 1 }, { arbitrary: 'x' }])('rejects malformed or unknown query %j', input => {
    expect(errors(input).length).toBeGreaterThan(0);
  });
});
