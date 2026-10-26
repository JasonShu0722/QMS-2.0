import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProcessEightDTaskQueryDto } from '../../src/modules/process-quality/process-eight-d-task.dto.js';

describe('process current-action task query DTO', () => {
  it('accepts bounded pagination and does not accept arbitrary action or assignee JSON', async () => {
    const options = { whitelist: true, forbidNonWhitelisted: true };
    expect(await validate(plainToInstance(ProcessEightDTaskQueryDto, { pageSize: '25', offset: '0' }), options)).toHaveLength(0);
    const bad = plainToInstance(ProcessEightDTaskQueryDto, { pageSize: 101, offset: -1, assigneeUserId: 'forged', action: { complete: true } });
    expect((await validate(bad, options)).map(e => e.property)).toEqual(expect.arrayContaining(['pageSize', 'offset', 'assigneeUserId', 'action']));
  });
});
