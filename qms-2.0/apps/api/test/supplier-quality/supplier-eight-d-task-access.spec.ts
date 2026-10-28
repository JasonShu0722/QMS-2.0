import { HttpException } from '@nestjs/common';
import { supplierTaskInaccessible } from '../../src/modules/supplier-quality/supplier-eight-d-reminder.service.js';

describe('supplier task transaction failures are not missing tasks', () => {
  it.each([403, 404])('filters a genuine inaccessible record (%s)', status => {
    expect(supplierTaskInaccessible(new HttpException({ code: 'SUPPLIER_RECORD_NOT_FOUND' }, status))).toBe(true);
  });
  it.each(['CONCURRENCY_CONFLICT', 'WORKFLOW_VERSION_MISMATCH', 'WORKFLOW_ACTION_INVALID'])('propagates every transaction/state 409, including %s', code => {
    expect(supplierTaskInaccessible(new HttpException({ code }, 409))).toBe(false);
  });
  it.each([{ code: 'P2034' }, { code: '40P01' }, { code: '40001' }, new Error('database unavailable')])('does not filter database failure %j', error => {
    expect(supplierTaskInaccessible(error)).toBe(false);
  });
});
