import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClosureInboxQueryDto } from '../../src/modules/task-notification/closure-inbox.dto.js';

describe('closure inbox query boundary', () => {
  it('accepts scoped UUID filters and transforms bounded pagination', async () => {
    const query = plainToInstance(ClosureInboxQueryDto, { organizationId: '2ee1b3dc-4bc9-4d89-9dcc-b6e20cd5bfbb', roundId: '5023a999-fc2d-4bfd-8d24-5846ccbba1fb', pageSize: '2', offset: '0' });
    expect(await validate(query)).toEqual([]);
    expect(query.pageSize).toBe(2);
  });

  it.each([{ problemId: 'not-a-uuid' }, { roundId: 'not-a-uuid' }, { pageSize: 0 }, { pageSize: 101 }, { offset: -1 }, { offset: 10001 }])('rejects invalid filter %j', async input => {
    expect(await validate(plainToInstance(ClosureInboxQueryDto, input))).not.toEqual([]);
  });
});
