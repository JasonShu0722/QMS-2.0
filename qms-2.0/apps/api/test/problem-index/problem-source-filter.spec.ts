import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ProblemIndexQueryDto } from '../../src/modules/problem-index/problem-index.dto.js';

it('accepts a bounded source type and rejects invalid query values', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const query = await pipe
    .transform({ sourceType: 'new-product-defect-selection', page: '2', pageSize: '1' }, { type: 'query', metatype: ProblemIndexQueryDto });
  expect(query).toHaveProperty('sourceType', 'new-product-defect-selection');
  for (const sourceType of [9, 'x'.repeat(101), null]) {
    await expect(pipe.transform({ sourceType }, { type: 'query', metatype: ProblemIndexQueryDto })).rejects.toMatchObject({ status: 400 });
  }
});
