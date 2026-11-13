import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NewProductIssueAssigneesQueryDto } from '../../src/modules/new-product-quality/new-product-quality.dto.js';

describe('new product trial issue assignee query', () => {
  it('supports bounded partial-name paging and rejects invalid or unrecognized scope inputs', async () => {
    const query = plainToInstance(NewProductIssueAssigneesQueryDto, { search: '张', page: '2', pageSize: '1' });
    expect(await validate(query, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(query).toMatchObject({ search: '张', page: 2, pageSize: 1 });
    for (const input of [{ page: 0 }, { pageSize: 101 }, { pageSize: 0 }, { search: 'a'.repeat(201) }, { organizationId: 'other' }, { role: 'admin' }]) {
      expect((await validate(plainToInstance(NewProductIssueAssigneesQueryDto, input), { whitelist: true, forbidNonWhitelisted: true })).length).toBeGreaterThan(0);
    }
  });
});
